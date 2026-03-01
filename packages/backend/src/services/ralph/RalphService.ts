// ============================================================
// Ralph Wiggum - Autonomous Development Loop Service
// ============================================================

import crypto from 'crypto';
import type { Server } from 'socket.io';
import { db } from '../../db';
import type { ClaudeProcessManager } from '../claude/ClaudeProcessManager';
import {
  DEFAULT_RALPH_CONFIG,
} from '@claude-code-webui/shared';
import type {
  RalphRunState,
  RalphPlan,
  RalphTask,
  RalphConfig,
  RalphProgress,
  RalphIteration,
  RalphTaskStatus,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const TURN_TIMEOUT_MS = 5 * 60 * 1000; // 5 min timeout for Claude turn
const MAX_PLAN_RETRIES = 3;
const DB_KEY = 'ralph_runs';

export class RalphService {
  private io: SocketServer;
  private processManager: ClaudeProcessManager;
  private runs: Map<string, RalphRunState> = new Map();
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private responseCollectors: Map<string, string[]> = new Map();

  constructor(io: SocketServer, processManager: ClaudeProcessManager) {
    this.io = io;
    this.processManager = processManager;
    this.loadPersistedRuns();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Collect assistant messages for response analysis
    this.processManager.events.on('assistantMessage', (sessionId: string, content: string) => {
      const collector = this.responseCollectors.get(sessionId);
      if (collector) {
        collector.push(content);
      }
    });
  }

  // ========== Persistence ==========

  private loadPersistedRuns(): void {
    try {
      const row = db.prepare(
        "SELECT value FROM app_config WHERE key = ?"
      ).get(DB_KEY) as { value: string } | undefined;

      if (row?.value) {
        const runsData = JSON.parse(row.value) as Record<string, RalphRunState>;
        for (const [id, run] of Object.entries(runsData)) {
          // Mark running runs as paused (container restart recovery)
          if (run.status === 'planning' || run.status === 'executing') {
            run.status = 'paused';
            run.pausedAt = Date.now();
            run.lastError = 'Container restart recovery';
          }
          this.runs.set(id, run);
        }
        if (this.runs.size > 0) {
          console.log(`[RALPH] Loaded ${this.runs.size} persisted runs`);
        }
      }
    } catch (err) {
      console.error('[RALPH] Failed to load persisted runs:', err);
    }
  }

  private persistRuns(): void {
    try {
      const runsData: Record<string, RalphRunState> = {};
      for (const [id, run] of this.runs) {
        runsData[id] = {
          ...run,
          // Keep only last 20 iterations to limit DB size
          iterations: run.iterations.slice(-20),
        };
      }
      db.prepare(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)"
      ).run(DB_KEY, JSON.stringify(runsData));
    } catch (err) {
      console.error('[RALPH] Failed to persist runs:', err);
    }
  }

  // ========== State Management ==========

  private updateRunState(runId: string, updates: Partial<RalphRunState>): void {
    const run = this.runs.get(runId);
    if (!run) return;

    Object.assign(run, updates);
    this.persistRuns();

    // Emit state update via WebSocket
    this.io.to(`session:${run.sessionId}`).emit('ralph:state', {
      sessionId: run.sessionId,
      run,
    });
  }

  /** Emit current run state to all clients in the session room. */
  emitRunState(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.io.to(`session:${run.sessionId}`).emit('ralph:state', {
      sessionId: run.sessionId,
      run,
    });
  }

  private emitProgress(run: RalphRunState): void {
    this.io.to(`session:${run.sessionId}`).emit('ralph:progress', {
      sessionId: run.sessionId,
      runId: run.id,
      progress: run.progress,
    });
  }

  private createProgress(run: RalphRunState): RalphProgress {
    if (!run.plan) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        currentTaskIndex: 0,
        currentIteration: run.iterations.length,
        totalIterations: run.config.maxTotalIterations,
        percentComplete: 0,
      };
    }

    const tasks = run.plan.tasks;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const current = tasks.findIndex(t => t.status === 'in_progress');

    return {
      totalTasks: tasks.length,
      completedTasks: completed,
      failedTasks: failed,
      currentTaskIndex: current >= 0 ? current : completed + failed,
      currentIteration: run.iterations.length,
      totalIterations: run.config.maxTotalIterations,
      percentComplete: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
    };
  }

  // ========== Session Management ==========

  private async ensureSession(userId: string, config: RalphConfig): Promise<string> {
    if (config.sessionId) {
      // Verify session exists
      const session = db.prepare(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ?'
      ).get(config.sessionId, userId) as { id: string } | undefined;

      if (session) return session.id;
      console.warn(`[RALPH] Session ${config.sessionId} not found, creating new one`);
    }

    // Create a new session
    const sessionId = crypto.randomUUID();
    const workingDir = config.workingDirectory || '/mnt/user/appdata/claude-code-webui';
    const cliProvider = config.cliProvider || 'claude';
    const name = `Ralph: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

    db.prepare(
      'INSERT INTO sessions (id, user_id, name, working_directory, cli_provider) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, userId, name, workingDir, cliProvider);

    console.log(`[RALPH] Created new session: ${sessionId}`);
    return sessionId;
  }

  // ========== Turn Waiting ==========

  private waitForTurnComplete(sessionId: string, timeoutMs: number = TURN_TIMEOUT_MS): Promise<{
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.processManager.events.removeListener('turnComplete', handler);
        reject(new Error('Turn timeout after ' + (timeoutMs / 1000) + 's'));
      }, timeoutMs);

      const handler = (sid: string, data: { inputTokens: number; outputTokens: number; totalCostUsd: number }) => {
        if (sid === sessionId) {
          clearTimeout(timeout);
          this.processManager.events.removeListener('turnComplete', handler);
          resolve(data);
        }
      };

      this.processManager.events.on('turnComplete', handler);
    });
  }

  private getCollectedResponse(sessionId: string): string {
    const messages = this.responseCollectors.get(sessionId) || [];
    // Return the last message (most complete assistant response)
    return messages.length > 0 ? (messages[messages.length - 1] ?? '') : '';
  }

  // ========== Planning ==========

  private buildPlanningPrompt(idea: string): string {
    return `You are executing an autonomous development task as part of the Ralph Wiggum workflow.

<user-idea>
${idea}
</user-idea>

Create a detailed implementation plan. Each task should be completable in one Claude turn (one prompt-response cycle).

Output your plan in this exact XML format:

<ralph-plan>
<task index="1" title="Short descriptive title">Detailed description of what to do, which files to modify, what code to write, and how to verify success.</task>
<task index="2" title="Short descriptive title">Detailed description...</task>
</ralph-plan>

Rules:
- Order tasks by dependency (earlier tasks first)
- Each task should be specific: name exact files, exact changes, exact verification steps
- 5-20 tasks is typical
- Each task must be completable in a single turn with available tools
- Include verification steps in each task description`;
  }

  private parsePlan(content: string, idea: string): RalphPlan | null {
    const planMatch = content.match(/<ralph-plan>([\s\S]*?)<\/ralph-plan>/);
    if (!planMatch) return null;

    const planContent = planMatch[1] ?? '';
    const taskRegex = /<task\s+index="(\d+)"\s+title="([^"]*)">([\s\S]*?)<\/task>/g;
    const tasks: RalphTask[] = [];

    let match;
    while ((match = taskRegex.exec(planContent)) !== null) {
      const indexStr = match[1] ?? '0';
      const title = match[2] ?? 'Untitled';
      const description = match[3] ?? '';
      tasks.push({
        id: crypto.randomUUID(),
        index: parseInt(indexStr, 10),
        title: title.trim(),
        description: description.trim(),
        status: 'pending' as RalphTaskStatus,
        attempts: 0,
      });
    }

    if (tasks.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      title: `Plan: ${idea.substring(0, 80)}`,
      description: idea,
      tasks,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // ========== Core Loop ==========

  async startRun(userId: string, idea: string, config?: Partial<RalphConfig>): Promise<RalphRunState> {
    const mergedConfig: RalphConfig = { ...DEFAULT_RALPH_CONFIG, ...config };

    // Ensure we have a session
    const sessionId = await this.ensureSession(userId, mergedConfig);
    mergedConfig.sessionId = sessionId;

    // Check if there's already an active run for this session
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && (run.status === 'planning' || run.status === 'executing')) {
        throw new Error(`Session ${sessionId} already has an active Ralph run`);
      }
    }

    const runId = crypto.randomUUID();
    const run: RalphRunState = {
      id: runId,
      sessionId,
      userId,
      config: mergedConfig,
      status: 'planning',
      plan: null,
      progress: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        currentTaskIndex: 0,
        currentIteration: 0,
        totalIterations: mergedConfig.maxTotalIterations,
        percentComplete: 0,
      },
      circuitBreaker: {
        noProgressCount: 0,
        noProgressThreshold: mergedConfig.noProgressThreshold,
        sameErrorCount: 0,
        sameErrorThreshold: mergedConfig.sameErrorThreshold,
        lastError: null,
        triggered: false,
      },
      costTracking: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      },
      iterations: [],
      createdAt: Date.now(),
      startedAt: Date.now(),
      idea,
    };

    this.runs.set(runId, run);
    this.persistRuns();

    // Set session to danger mode if configured
    if (mergedConfig.dangerMode) {
      try {
        this.processManager.setMode(sessionId, userId, 'danger');
      } catch {
        // Session may not have a process yet, mode will be set on start
      }
    }

    // NOTE: We do NOT emit initial state here. The caller (websocket handler)
    // must join the socket room first, then call emitRunState() to avoid
    // a race condition where the client misses the initial event.

    // Start planning phase (async, don't await)
    this.executePlanning(runId).catch(err => {
      console.error(`[RALPH] Planning failed for run ${runId}:`, err);
      this.updateRunState(runId, {
        status: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
        completedAt: Date.now(),
      });
      this.io.to(`session:${sessionId}`).emit('ralph:error', {
        sessionId,
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return run;
  }

  private async executePlanning(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'planning') return;

    const planningPrompt = this.buildPlanningPrompt(run.idea);
    let plan: RalphPlan | null = null;

    for (let attempt = 0; attempt < MAX_PLAN_RETRIES; attempt++) {
      console.log(`[RALPH] Planning attempt ${attempt + 1}/${MAX_PLAN_RETRIES} for run ${runId}`);

      // Start collecting responses
      this.responseCollectors.set(run.sessionId, []);

      try {
        const prompt = attempt === 0
          ? planningPrompt
          : planningPrompt + '\n\nIMPORTANT: Your previous response did not contain a valid plan in the required <ralph-plan> XML format. Please output the plan using the exact XML format specified above.';

        // Send planning prompt (hidden from chat UI)
        await this.processManager.sendMessage(
          run.sessionId, run.userId, prompt, undefined, { recordMessage: false }
        );

        // Wait for turn to complete
        const turnData = await this.waitForTurnComplete(run.sessionId);

        // Update cost tracking
        run.costTracking.totalInputTokens += turnData.inputTokens;
        run.costTracking.totalOutputTokens += turnData.outputTokens;
        run.costTracking.totalCostUsd = turnData.totalCostUsd;

        // Get response content
        const responseContent = this.getCollectedResponse(run.sessionId);
        this.responseCollectors.delete(run.sessionId);

        // Parse plan
        plan = this.parsePlan(responseContent, run.idea);
        if (plan) {
          console.log(`[RALPH] Plan parsed successfully: ${plan.tasks.length} tasks`);
          break;
        }

        console.warn(`[RALPH] Plan parsing failed on attempt ${attempt + 1}`);
      } catch (err) {
        console.error(`[RALPH] Planning attempt ${attempt + 1} error:`, err);
        this.responseCollectors.delete(run.sessionId);

        if (attempt === MAX_PLAN_RETRIES - 1) {
          throw new Error(
            'Failed to generate plan after ' + MAX_PLAN_RETRIES + ' attempts: ' +
            (err instanceof Error ? err.message : String(err))
          );
        }
      }
    }

    if (!plan) {
      throw new Error('Failed to parse plan from Claude response');
    }

    // Update run with plan
    this.updateRunState(runId, {
      plan,
      status: 'executing',
      progress: this.createProgress({ ...run, plan }),
    });

    // Emit plan event
    this.io.to(`session:${run.sessionId}`).emit('ralph:plan', {
      sessionId: run.sessionId,
      runId,
      plan,
    });

    // Start executing tasks
    this.scheduleNextTask(runId);
  }

  private scheduleNextTask(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    // Clear any existing timer
    const existingTimer = this.activeTimers.get(runId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.activeTimers.delete(runId);
      this.executeNextTask(runId).catch(err => {
        console.error(`[RALPH] Task execution error for run ${runId}:`, err);
        this.updateRunState(runId, {
          status: 'paused',
          lastError: err instanceof Error ? err.message : String(err),
          pausedAt: Date.now(),
        });
        this.notifyTelegram('Ralph paused: ' + (err instanceof Error ? err.message : String(err)));
      });
    }, run.config.iterationDelayMs);

    this.activeTimers.set(runId, timer);
  }

  private async executeNextTask(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || !run.plan) return;

    // Check if run is still active
    if (run.status !== 'executing') {
      console.log(`[RALPH] Run ${runId} is ${run.status}, skipping task execution`);
      return;
    }

    // Find next pending task
    const nextTask = run.plan.tasks.find(t => t.status === 'pending');
    if (!nextTask) {
      this.completeRun(runId);
      return;
    }

    // Check iteration limits
    if (run.iterations.length >= run.config.maxTotalIterations) {
      this.updateRunState(runId, {
        status: 'paused',
        lastError: 'Max total iterations reached (' + run.config.maxTotalIterations + ')',
        pausedAt: Date.now(),
      });
      this.notifyTelegram('Ralph paused: Max iterations reached (' + run.config.maxTotalIterations + ')');
      return;
    }

    // Check cost limits
    if (run.config.maxCostUsd && run.costTracking.totalCostUsd >= run.config.maxCostUsd) {
      this.updateRunState(runId, {
        status: 'paused',
        lastError: 'Cost limit reached ($' + run.costTracking.totalCostUsd.toFixed(2) + '/$' + run.config.maxCostUsd.toFixed(2) + ')',
        pausedAt: Date.now(),
      });
      this.notifyTelegram('Ralph paused: Cost limit $' + run.costTracking.totalCostUsd.toFixed(2));
      return;
    }

    // Mark task as in_progress
    nextTask.status = 'in_progress';
    nextTask.attempts++;
    nextTask.startedAt = Date.now();

    // Create iteration record
    const iteration: RalphIteration = {
      id: crypto.randomUUID(),
      runId,
      taskId: nextTask.id,
      iterationNumber: run.iterations.length + 1,
      promptSent: '',
      responseReceived: false,
      toolCallCount: 0,
      errorCount: 0,
      completionDetected: false,
      startedAt: Date.now(),
    };

    // Build task prompt
    const completedTasks = run.plan.tasks
      .filter(t => t.status === 'completed')
      .map(t => `  ${t.index}. ${t.title}`)
      .join('\n');

    const taskPrompt = `<ralph-context>
Plan: ${run.plan.title}
Completed tasks:
${completedTasks || '  (none yet)'}

Current task (${nextTask.index}/${run.plan.tasks.length}): ${nextTask.title}
Attempt: ${nextTask.attempts}${nextTask.lastError ? '\nPrevious error: ' + nextTask.lastError : ''}
</ralph-context>

Execute this task now: ${nextTask.description}

When the task is fully completed and verified, output: <ralph-task-complete />
If you are stuck and cannot complete the task, output: <ralph-task-failed reason="description of what went wrong" />`;

    iteration.promptSent = taskPrompt;

    // Start collecting responses
    this.responseCollectors.set(run.sessionId, []);

    try {
      // Send task prompt (hidden from chat UI)
      await this.processManager.sendMessage(
        run.sessionId, run.userId, taskPrompt, undefined, { recordMessage: false }
      );

      // Wait for turn complete
      const turnData = await this.waitForTurnComplete(run.sessionId);

      // Update cost tracking
      run.costTracking.totalInputTokens += turnData.inputTokens;
      run.costTracking.totalOutputTokens += turnData.outputTokens;
      run.costTracking.totalCostUsd = turnData.totalCostUsd;

      iteration.responseReceived = true;
      iteration.completedAt = Date.now();
      iteration.durationMs = iteration.completedAt - iteration.startedAt;

      // Get response
      const response = this.getCollectedResponse(run.sessionId);
      this.responseCollectors.delete(run.sessionId);

      // Analyze response
      this.analyzeResponse(run, nextTask, iteration, response);
    } catch (err) {
      this.responseCollectors.delete(run.sessionId);
      iteration.errorCount++;
      iteration.completedAt = Date.now();
      iteration.durationMs = iteration.completedAt - iteration.startedAt;

      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[RALPH] Task execution error:`, errorMsg);

      // Check if it's a timeout
      if (errorMsg.includes('Turn timeout')) {
        nextTask.status = 'pending';
        nextTask.lastError = 'Claude response timeout';

        this.updateRunState(runId, {
          status: 'paused',
          lastError: 'Turn timeout - Claude took too long to respond',
          pausedAt: Date.now(),
        });
        this.notifyTelegram('Ralph paused: Claude response timeout');
        run.iterations.push(iteration);
        this.persistRuns();
        return;
      }

      nextTask.lastError = errorMsg;
    }

    // Add iteration to run
    run.iterations.push(iteration);

    // Emit iteration event
    this.io.to(`session:${run.sessionId}`).emit('ralph:iteration', {
      sessionId: run.sessionId,
      runId,
      iteration,
    });

    // Update progress
    run.progress = this.createProgress(run);
    this.emitProgress(run);
    this.persistRuns();

    // Check circuit breaker
    if (this.checkCircuitBreaker(run)) {
      return;
    }

    // Schedule next task
    if (run.status === 'executing') {
      this.scheduleNextTask(runId);
    }
  }

  // ========== Response Analysis ==========

  /**
   * Detect fatal errors that should immediately pause the run.
   * Returns error category string if fatal, null otherwise.
   */
  private detectFatalError(response: string): string | null {
    const lower = response.toLowerCase();

    // Rate limit / usage limit (OpenAI, Anthropic, Google)
    if (lower.includes('usage limit') || lower.includes('rate limit') ||
        lower.includes('upgrade to pro') || lower.includes('purchase more credits') ||
        lower.includes('too many requests') || lower.includes('quota exceeded') ||
        lower.includes('billing') || /try again (?:at|in) \d/.test(lower)) {
      return 'Rate limit reached';
    }

    // Auth / credential errors
    if (lower.includes('unauthorized') || lower.includes('authentication failed') ||
        lower.includes('invalid api key') || lower.includes('expired token') ||
        lower.includes('login required')) {
      return 'Authentication error';
    }

    // Persistent sandbox/permission errors
    if (lower.includes('landlockrestrict') || lower.includes('sandbox(landlock')) {
      return 'Sandbox blocking all operations';
    }

    return null;
  }

  private analyzeResponse(
    run: RalphRunState,
    task: RalphTask,
    iteration: RalphIteration,
    response: string
  ): void {
    // Check for fatal errors first (rate limits, auth, persistent sandbox)
    const fatalError = this.detectFatalError(response);
    if (fatalError) {
      task.lastError = fatalError;
      task.status = 'pending'; // Don't mark failed — it's an env issue, not task issue
      iteration.errorCount++;

      // Immediately trigger circuit breaker
      run.circuitBreaker.triggered = true;
      run.circuitBreaker.triggerReason = fatalError;
      this.updateRunState(run.id, {
        status: 'paused',
        circuitBreaker: run.circuitBreaker,
        pausedAt: Date.now(),
        lastError: fatalError,
      });
      this.notifyTelegram(`Ralph paused: ${fatalError}`);
      console.log(`[RALPH] Fatal error detected: ${fatalError}`);
      return;
    }

    // Check for task completion
    if (
      response.includes('<ralph-task-complete') ||
      response.includes('<ralph-task-complete/>') ||
      response.includes('<ralph-task-complete />')
    ) {
      task.status = 'completed';
      task.completedAt = Date.now();
      iteration.completionDetected = true;

      // Reset circuit breaker on progress
      run.circuitBreaker.noProgressCount = 0;
      run.circuitBreaker.sameErrorCount = 0;
      run.circuitBreaker.lastError = null;

      console.log(`[RALPH] Task ${task.index} completed: ${task.title}`);
      return;
    }

    // Check for task failure
    const failMatch = response.match(/<ralph-task-failed\s+reason="([^"]*)"[^/]*\/?>/);
    if (failMatch) {
      const reason = failMatch[1] ?? 'Unknown error';
      task.lastError = reason;
      iteration.errorCount++;

      // Check if we should retry
      if (task.attempts < run.config.maxIterationsPerTask) {
        task.status = 'pending';
        console.log(`[RALPH] Task ${task.index} failed (attempt ${task.attempts}): ${reason}`);
      } else {
        task.status = 'failed';
        console.log(`[RALPH] Task ${task.index} permanently failed: ${reason}`);
      }

      // Update circuit breaker — use fuzzy matching for similar errors
      // (LLM responses are never identical, so exact match rarely triggers)
      const lastErr = run.circuitBreaker.lastError || '';
      const isSimilar = lastErr.length > 20 && reason.length > 20 &&
        (reason.includes(lastErr.substring(0, 30)) || lastErr.includes(reason.substring(0, 30)) ||
         this.errorSimilarity(lastErr, reason) > 0.5);

      if (isSimilar) {
        run.circuitBreaker.sameErrorCount++;
      } else {
        run.circuitBreaker.sameErrorCount = 1;
      }
      run.circuitBreaker.lastError = reason;

      // Task failures count as no-progress too
      run.circuitBreaker.noProgressCount++;
      return;
    }

    // No explicit signal - check for implicit progress
    const toolCallMatches = response.match(/tool_use|Bash|Read|Write|Edit|Glob|Grep/g);
    iteration.toolCallCount = toolCallMatches ? toolCallMatches.length : 0;

    if (iteration.toolCallCount > 0) {
      // Some progress was made, but task not explicitly completed
      run.circuitBreaker.noProgressCount = 0;

      // Check iteration limit per task
      if (task.attempts >= run.config.maxIterationsPerTask) {
        task.status = 'failed';
        task.lastError = 'Max iterations per task reached without completion signal';
        console.log(`[RALPH] Task ${task.index} failed: max iterations reached`);
      } else {
        task.status = 'pending';
        console.log(`[RALPH] Task ${task.index} in progress (${iteration.toolCallCount} tool calls, attempt ${task.attempts})`);
      }
    } else {
      // No tool calls and no completion signal - no progress
      run.circuitBreaker.noProgressCount++;
      task.status = 'pending';
      console.log(`[RALPH] Task ${task.index}: No progress (${run.circuitBreaker.noProgressCount}/${run.circuitBreaker.noProgressThreshold})`);
    }
  }

  /**
   * Simple word-overlap similarity for error messages.
   * Returns 0..1 (1 = identical words).
   */
  private errorSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  // ========== Circuit Breaker ==========

  private checkCircuitBreaker(run: RalphRunState): boolean {
    const cb = run.circuitBreaker;

    // No progress circuit breaker
    if (cb.noProgressCount >= cb.noProgressThreshold) {
      cb.triggered = true;
      cb.triggerReason = 'No progress for ' + cb.noProgressCount + ' iterations';
      this.updateRunState(run.id, {
        status: 'paused',
        circuitBreaker: cb,
        pausedAt: Date.now(),
        lastError: cb.triggerReason,
      });
      this.notifyTelegram('Circuit breaker: ' + cb.triggerReason);
      console.log(`[RALPH] Circuit breaker triggered: ${cb.triggerReason}`);
      return true;
    }

    // Same error circuit breaker
    if (cb.sameErrorCount >= cb.sameErrorThreshold) {
      cb.triggered = true;
      cb.triggerReason = 'Same error repeated ' + cb.sameErrorCount + ' times: ' + cb.lastError;
      this.updateRunState(run.id, {
        status: 'paused',
        circuitBreaker: cb,
        pausedAt: Date.now(),
        lastError: cb.triggerReason,
      });
      this.notifyTelegram('Circuit breaker: ' + cb.triggerReason);
      console.log(`[RALPH] Circuit breaker triggered: ${cb.triggerReason}`);
      return true;
    }

    return false;
  }

  // ========== Run Lifecycle ==========

  private completeRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const completedTasks = run.plan?.tasks.filter(t => t.status === 'completed').length || 0;
    const failedTasks = run.plan?.tasks.filter(t => t.status === 'failed').length || 0;
    const totalTasks = run.plan?.tasks.length || 0;

    const exitReason = failedTasks > 0
      ? 'Completed ' + completedTasks + '/' + totalTasks + ' tasks (' + failedTasks + ' failed)'
      : 'All ' + totalTasks + ' tasks completed successfully';

    this.updateRunState(runId, {
      status: 'completed',
      completedAt: Date.now(),
      exitReason,
      progress: this.createProgress(run),
    });

    this.io.to(`session:${run.sessionId}`).emit('ralph:completed', {
      sessionId: run.sessionId,
      runId,
      exitReason,
    });

    this.notifyTelegram('Ralph completed: ' + exitReason);
    console.log(`[RALPH] Run ${runId} completed: ${exitReason}`);
  }

  async pauseRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run ' + runId + ' not found');
    if (run.status !== 'executing' && run.status !== 'planning') {
      throw new Error('Run ' + runId + ' is not active (status: ' + run.status + ')');
    }

    // Cancel any pending timer
    const timer = this.activeTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(runId);
    }

    this.updateRunState(runId, {
      status: 'paused',
      pausedAt: Date.now(),
    });

    console.log(`[RALPH] Run ${runId} paused`);
  }

  async resumeRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run ' + runId + ' not found');
    if (run.status !== 'paused') {
      throw new Error('Run ' + runId + ' is not paused (status: ' + run.status + ')');
    }

    // Reset circuit breaker
    run.circuitBreaker.triggered = false;
    run.circuitBreaker.noProgressCount = 0;
    run.circuitBreaker.sameErrorCount = 0;

    if (run.plan) {
      this.updateRunState(runId, {
        status: 'executing',
        pausedAt: undefined,
        circuitBreaker: run.circuitBreaker,
      });
      this.scheduleNextTask(runId);
    } else {
      // Resume planning
      this.updateRunState(runId, {
        status: 'planning',
        pausedAt: undefined,
        circuitBreaker: run.circuitBreaker,
      });
      this.executePlanning(runId).catch(err => {
        console.error(`[RALPH] Planning resume failed:`, err);
        this.updateRunState(runId, {
          status: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        });
      });
    }

    console.log(`[RALPH] Run ${runId} resumed`);
  }

  async stopRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run ' + runId + ' not found');

    // Cancel any pending timer
    const timer = this.activeTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(runId);
    }

    // Clean up response collector
    this.responseCollectors.delete(run.sessionId);

    this.updateRunState(runId, {
      status: 'stopped',
      completedAt: Date.now(),
      exitReason: 'Manually stopped by user',
    });

    console.log(`[RALPH] Run ${runId} stopped`);
  }

  // ========== Queries ==========

  getAllRuns(): RalphRunState[] {
    return Array.from(this.runs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunState(runId: string): RalphRunState | null {
    return this.runs.get(runId) || null;
  }

  getRunBySession(sessionId: string): RalphRunState | null {
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId && (run.status === 'planning' || run.status === 'executing' || run.status === 'paused')) {
        return run;
      }
    }
    return null;
  }

  // ========== Telegram Notifications ==========

  private async notifyTelegram(message: string): Promise<void> {
    try {
      const { getWatchdog } = await import('../watchdog/WatchdogService');
      const watchdog = getWatchdog();
      if (watchdog) {
        await watchdog.sendTelegramNotification('ralph', message);
      }
    } catch {
      // Watchdog not available, skip notification
    }
  }
}

// ========== Singleton ==========

let ralphInstance: RalphService | null = null;

export function initRalph(io: SocketServer, processManager: ClaudeProcessManager): RalphService {
  if (!ralphInstance) {
    ralphInstance = new RalphService(io, processManager);
    console.log('[RALPH] Service initialized');
  }
  return ralphInstance;
}

export function getRalph(): RalphService | null {
  return ralphInstance;
}
