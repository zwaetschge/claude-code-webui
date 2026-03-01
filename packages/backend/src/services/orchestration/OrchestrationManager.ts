/**
 * OrchestrationManager - Manages multi-CLI orchestration sessions
 *
 * Claude Code acts as the orchestrator, delegating tasks to worker CLIs
 * (Codex, Gemini, GLM) based on task characteristics.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import type {
  CLIProvider,
  OrchestrationConfig,
  OrchestrationState,
  OrchestrationTask,
  OrchestrationPhase,
  WorkerState,
  TaskResult,
  TaskDelegation,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';
import { getDatabase } from '../../db/index.js';
import { WorkerProcessManager, workerProcessManager } from './WorkerProcessManager.js';
import { TaskRouter, defaultTaskRouter } from './TaskRouter.js';

export interface OrchestrationSession {
  id: string;
  sessionId: string;
  userId: string;
  config: OrchestrationConfig;
  state: OrchestrationState;
  taskQueue: TaskDelegation[];
  activeTaskCount: number;
  results: Map<string, TaskResult>;
  startedAt?: Date;
  completedAt?: Date;
}

type OrchestrationIO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export class OrchestrationManager extends EventEmitter {
  private sessions: Map<string, OrchestrationSession> = new Map();
  private io: OrchestrationIO | null = null;
  private workerManager: WorkerProcessManager;
  private taskRouter: TaskRouter;

  constructor(
    workerManager: WorkerProcessManager = workerProcessManager,
    taskRouter: TaskRouter = defaultTaskRouter
  ) {
    super();
    this.workerManager = workerManager;
    this.taskRouter = taskRouter;

    // Listen to worker events
    this.setupWorkerListeners();
  }

  /**
   * Set the Socket.IO server for emitting events
   */
  setIO(io: OrchestrationIO): void {
    this.io = io;
  }

  /**
   * Setup listeners for worker events
   */
  private setupWorkerListeners(): void {
    this.workerManager.on('output', (data) => {
      this.handleWorkerOutput(data);
    });

    this.workerManager.on('status', (workerId, status, error) => {
      this.handleWorkerStatusChange(workerId, status, error);
    });

    this.workerManager.on('taskComplete', (workerId, taskId, result, success, error) => {
      this.handleTaskComplete(workerId, taskId, result, success, error);
    });

    this.workerManager.on('error', (workerId, error) => {
      console.error(`[ORCHESTRATION] Worker ${workerId} error:`, error);
    });
  }

  /**
   * Start orchestration for a session
   */
  async startOrchestration(
    sessionId: string,
    userId: string,
    config: Partial<OrchestrationConfig> = {}
  ): Promise<OrchestrationSession> {
    // Check if already orchestrating
    if (this.sessions.has(sessionId)) {
      throw new Error(`Orchestration already active for session ${sessionId}`);
    }

    // Get session info from database
    const db = getDatabase();
    const session = db
      .prepare('SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { working_directory: string } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    // Create full config with defaults
    const fullConfig: OrchestrationConfig = {
      master: 'claude',
      workers: [
        { provider: 'codex', maxConcurrent: 1, specialization: 'reasoning', enabled: true },
        { provider: 'gemini', maxConcurrent: 1, specialization: 'frontend', enabled: true },
        { provider: 'glm', maxConcurrent: 1, specialization: 'quick', enabled: false },
      ],
      taskRouting: 'auto',
      parallelExecution: true,
      maxParallelTasks: 3,
      ...config,
    };

    // Create orchestration session
    const orchestrationId = nanoid();
    const orchestration: OrchestrationSession = {
      id: orchestrationId,
      sessionId,
      userId,
      config: fullConfig,
      state: {
        sessionId,
        isOrchestrating: true,
        config: fullConfig,
        workers: [],
        tasks: [],
        currentPhase: 'idle',
      },
      taskQueue: [],
      activeTaskCount: 0,
      results: new Map(),
      startedAt: new Date(),
    };

    this.sessions.set(sessionId, orchestration);

    // Save to database
    this.saveOrchestrationSession(orchestration);

    // Spawn workers for enabled providers
    await this.spawnWorkers(orchestration, session.working_directory);

    // Update phase
    this.updatePhase(sessionId, 'idle', 'Orchestration bereit');

    console.log(`[ORCHESTRATION] Started for session ${sessionId} with ${orchestration.state.workers.length} workers`);

    return orchestration;
  }

  /**
   * Spawn workers based on configuration
   */
  private async spawnWorkers(orchestration: OrchestrationSession, workingDirectory: string): Promise<void> {
    const enabledWorkers = orchestration.config.workers.filter((w) => w.enabled);

    for (const workerConfig of enabledWorkers) {
      try {
        const worker = await this.workerManager.spawnWorker(
          orchestration.sessionId,
          workerConfig.provider,
          workingDirectory,
          orchestration.userId
        );

        orchestration.state.workers.push({
          id: worker.id,
          provider: worker.provider,
          status: 'idle',
        });

        console.log(`[ORCHESTRATION] Spawned worker ${worker.id} (${workerConfig.provider})`);
      } catch (error) {
        console.error(`[ORCHESTRATION] Failed to spawn ${workerConfig.provider} worker:`, error);
        // Continue with other workers
      }
    }

    // Emit updated state
    this.emitState(orchestration.sessionId);
  }

  /**
   * Stop orchestration for a session
   */
  async stopOrchestration(sessionId: string): Promise<void> {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) {
      return;
    }

    console.log(`[ORCHESTRATION] Stopping for session ${sessionId}`);

    // Terminate all workers
    this.workerManager.terminateSessionWorkers(sessionId);

    // Update state
    orchestration.state.isOrchestrating = false;
    orchestration.state.currentPhase = 'idle';
    orchestration.completedAt = new Date();

    // Update database
    this.updateOrchestrationStatus(sessionId, 'completed');

    // Emit final state
    this.emitState(sessionId);

    // Cleanup
    this.sessions.delete(sessionId);
  }

  /**
   * Delegate a task to a worker
   */
  async delegateTask(sessionId: string, task: TaskDelegation): Promise<void> {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) {
      throw new Error(`No orchestration session for ${sessionId}`);
    }

    console.log(`[ORCHESTRATION] Delegating task ${task.taskId} to ${task.workerType}`);

    // Create task record
    const orchestrationTask: OrchestrationTask = {
      id: task.taskId,
      orchestrationId: orchestration.id,
      description: task.task,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    orchestration.state.tasks.push(orchestrationTask);

    // If manual routing or no auto-routing available, use specified worker
    let targetProvider = task.workerType;

    // If auto-routing enabled and provider not specified or is 'auto'
    if (orchestration.config.taskRouting === 'auto') {
      const availableWorkers = orchestration.config.workers.filter((w) => w.enabled);
      targetProvider = this.taskRouter.routeTask(task.task, availableWorkers);
    }

    // Find an idle worker of the target type
    const worker = this.workerManager.getIdleWorker(sessionId, targetProvider);

    if (!worker) {
      // Queue the task if no idle worker available
      task.workerType = targetProvider;
      orchestration.taskQueue.push(task);
      orchestrationTask.status = 'pending';
      console.log(`[ORCHESTRATION] No idle ${targetProvider} worker, queued task ${task.taskId}`);
    } else {
      // Send task to worker
      orchestrationTask.status = 'delegated';
      orchestrationTask.workerId = worker.id;
      orchestrationTask.delegatedAt = new Date().toISOString();
      orchestration.activeTaskCount++;

      try {
        await this.workerManager.sendTask(worker.id, task.taskId, task.task, task.context);
        orchestrationTask.status = 'running';

        // Update worker state
        const workerState = orchestration.state.workers.find((w) => w.id === worker.id);
        if (workerState) {
          workerState.status = 'busy';
          workerState.currentTaskId = task.taskId;
          workerState.currentTask = task.task.substring(0, 100);
        }
      } catch (error) {
        orchestrationTask.status = 'failed';
        orchestrationTask.error = error instanceof Error ? error.message : 'Unknown error';
        orchestration.activeTaskCount--;
      }
    }

    // Update phase
    if (orchestration.activeTaskCount > 0 || orchestration.taskQueue.length > 0) {
      this.updatePhase(sessionId, 'executing', `${orchestration.activeTaskCount} Tasks werden ausgeführt`);
    }

    // Emit events
    this.emitTaskDelegated(sessionId, orchestrationTask, worker?.id);
    this.emitState(sessionId);

    // Save task to database
    this.saveTask(orchestration.id, orchestrationTask);
  }

  /**
   * Handle worker output
   */
  private handleWorkerOutput(data: {
    workerId: string;
    provider: CLIProvider;
    content: string;
    isPartial: boolean;
    isError: boolean;
  }): void {
    // Find the session this worker belongs to
    const worker = this.workerManager.getWorker(data.workerId);
    if (!worker) return;

    const sessionId = worker.sessionId;
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    // Emit worker output to clients
    this.emitWorkerOutput(sessionId, data.workerId, data.provider, data.content, data.isPartial);
  }

  /**
   * Handle worker status change
   */
  private handleWorkerStatusChange(workerId: string, status: string, error?: string): void {
    const worker = this.workerManager.getWorker(workerId);
    if (!worker) return;

    const sessionId = worker.sessionId;
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    // Update worker state
    const workerState = orchestration.state.workers.find((w) => w.id === workerId);
    if (workerState) {
      workerState.status = status as WorkerState['status'];
      if (error) {
        workerState.errorMessage = error;
      }
    }

    // Emit status update
    this.emitWorkerStatus(sessionId, workerId, status as WorkerState['status'], error);

    // If worker became idle, check for queued tasks
    if (status === 'idle') {
      this.processTaskQueue(sessionId);
    }
  }

  /**
   * Handle task completion
   */
  private handleTaskComplete(
    workerId: string,
    taskId: string,
    result: string,
    success: boolean,
    error?: string
  ): void {
    const worker = this.workerManager.getWorker(workerId);
    if (!worker) return;

    const sessionId = worker.sessionId;
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    console.log(`[ORCHESTRATION] Task ${taskId} completed by ${workerId}: ${success ? 'success' : 'failed'}`);

    // Update task
    const task = orchestration.state.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = success ? 'completed' : 'failed';
      task.result = result;
      task.error = error;
      task.completedAt = new Date().toISOString();
    }

    // Store result
    orchestration.results.set(taskId, {
      taskId,
      workerId,
      success,
      result,
      error,
      duration: task ? Date.now() - new Date(task.createdAt).getTime() : 0,
      completedAt: new Date().toISOString(),
    });

    orchestration.activeTaskCount--;

    // Update worker state
    const workerState = orchestration.state.workers.find((w) => w.id === workerId);
    if (workerState) {
      workerState.status = 'idle';
      workerState.currentTaskId = undefined;
      workerState.currentTask = undefined;
    }

    // Emit events
    if (task) {
      this.emitTaskCompleted(sessionId, task, orchestration.results.get(taskId)!);
    }

    // Emit error event if task failed
    if (!success && error) {
      this.emitError(sessionId, error, taskId, workerId);
    }

    // Update phase
    if (orchestration.activeTaskCount === 0 && orchestration.taskQueue.length === 0) {
      this.updatePhase(sessionId, 'synthesizing', 'Ergebnisse werden zusammengefasst');
    }

    // Process queued tasks
    this.processTaskQueue(sessionId);

    // Update database
    if (task) {
      this.updateTask(orchestration.id, task);
    }
  }

  /**
   * Process queued tasks
   */
  private async processTaskQueue(sessionId: string): Promise<void> {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration || orchestration.taskQueue.length === 0) return;

    // Check if we can run more tasks
    if (orchestration.activeTaskCount >= orchestration.config.maxParallelTasks) return;

    // Find tasks that can be started
    const toProcess: TaskDelegation[] = [];
    const remaining: TaskDelegation[] = [];

    for (const task of orchestration.taskQueue) {
      if (toProcess.length >= (orchestration.config.maxParallelTasks - orchestration.activeTaskCount)) {
        remaining.push(task);
        continue;
      }

      // Check if there's an idle worker for this task
      const worker = this.workerManager.getIdleWorker(sessionId, task.workerType);
      if (worker) {
        toProcess.push(task);
      } else {
        remaining.push(task);
      }
    }

    orchestration.taskQueue = remaining;

    // Start tasks
    for (const task of toProcess) {
      await this.delegateTask(sessionId, task);
    }
  }

  /**
   * Get orchestration state
   */
  getState(sessionId: string): OrchestrationState | null {
    const orchestration = this.sessions.get(sessionId);
    return orchestration?.state || null;
  }

  /**
   * Get orchestration configuration
   */
  getConfig(sessionId: string): OrchestrationConfig | null {
    const orchestration = this.sessions.get(sessionId);
    return orchestration?.config || null;
  }

  /**
   * Update orchestration configuration
   */
  updateConfig(sessionId: string, config: Partial<OrchestrationConfig>): OrchestrationConfig | null {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return null;

    orchestration.config = { ...orchestration.config, ...config };
    orchestration.state.config = orchestration.config;

    this.emitState(sessionId);
    return orchestration.config;
  }

  /**
   * Interrupt a specific worker
   */
  interruptWorker(sessionId: string, workerId: string): void {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    this.workerManager.interruptWorker(workerId);
  }

  /**
   * Cancel a task
   */
  cancelTask(sessionId: string, taskId: string): void {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    // Find task
    const task = orchestration.state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // If running, interrupt the worker
    if (task.status === 'running' && task.workerId) {
      this.workerManager.interruptWorker(task.workerId);
    }

    // Remove from queue if pending
    orchestration.taskQueue = orchestration.taskQueue.filter((t) => t.taskId !== taskId);

    // Update task status
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();

    this.emitState(sessionId);
  }

  /**
   * Get all task results
   */
  getResults(sessionId: string): TaskResult[] {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return [];

    return Array.from(orchestration.results.values());
  }

  /**
   * Synthesize results from all completed tasks
   */
  synthesizeResults(sessionId: string): string {
    const results = this.getResults(sessionId);
    if (results.length === 0) return '';

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    let synthesis = '## Orchestration Results\n\n';

    if (successful.length > 0) {
      synthesis += `### Completed Tasks (${successful.length})\n\n`;
      for (const result of successful) {
        synthesis += `- **Task ${result.taskId}** (${result.duration}ms):\n${result.result}\n\n`;
      }
    }

    if (failed.length > 0) {
      synthesis += `### Failed Tasks (${failed.length})\n\n`;
      for (const result of failed) {
        synthesis += `- **Task ${result.taskId}**: ${result.error}\n`;
      }
    }

    return synthesis;
  }

  /**
   * Check if session has active orchestration
   */
  isOrchestrating(sessionId: string): boolean {
    const orchestration = this.sessions.get(sessionId);
    return orchestration?.state.isOrchestrating || false;
  }

  // ========== Phase Management ==========

  private updatePhase(sessionId: string, phase: OrchestrationPhase, message?: string): void {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration) return;

    orchestration.state.currentPhase = phase;
    orchestration.state.phaseMessage = message;

    this.emitPhase(sessionId, phase, message);
  }

  // ========== Event Emitters ==========

  private emitState(sessionId: string): void {
    const orchestration = this.sessions.get(sessionId);
    if (!orchestration || !this.io) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:state' as keyof ServerToClientEvents, orchestration.state as never);
  }

  private emitPhase(sessionId: string, phase: OrchestrationPhase, message?: string): void {
    if (!this.io) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:phase' as keyof ServerToClientEvents, {
      sessionId,
      phase,
      message,
    } as never);
  }

  private emitWorkerStatus(sessionId: string, workerId: string, _status: WorkerState['status'], _error?: string): void {
    if (!this.io) return;

    const orchestration = this.sessions.get(sessionId);
    const workerState = orchestration?.state.workers.find((w) => w.id === workerId);
    if (!workerState) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:worker_status' as keyof ServerToClientEvents, {
      sessionId,
      worker: workerState,
    } as never);
  }

  private emitWorkerOutput(
    sessionId: string,
    workerId: string,
    provider: CLIProvider,
    content: string,
    isPartial: boolean
  ): void {
    if (!this.io) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:worker_output' as keyof ServerToClientEvents, {
      sessionId,
      workerId,
      provider,
      content,
      isPartial,
    } as never);
  }

  private emitTaskDelegated(sessionId: string, task: OrchestrationTask, workerId?: string): void {
    if (!this.io) return;

    const orchestration = this.sessions.get(sessionId);
    const workerState = workerId
      ? orchestration?.state.workers.find((w) => w.id === workerId)
      : undefined;

    this.io.to(`session:${sessionId}`).emit('orchestration:task_delegated' as keyof ServerToClientEvents, {
      sessionId,
      task,
      worker: workerState || { id: '', provider: 'claude', status: 'idle' },
    } as never);
  }

  private emitTaskCompleted(sessionId: string, task: OrchestrationTask, result: TaskResult): void {
    if (!this.io) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:task_completed' as keyof ServerToClientEvents, {
      sessionId,
      task,
      result,
    } as never);
  }

  private emitError(sessionId: string, error: string, taskId?: string, workerId?: string): void {
    if (!this.io) return;

    this.io.to(`session:${sessionId}`).emit('orchestration:error' as keyof ServerToClientEvents, {
      sessionId,
      error,
      taskId,
      workerId,
    } as never);
  }

  // ========== Database Operations ==========

  private saveOrchestrationSession(orchestration: OrchestrationSession): void {
    const db = getDatabase();

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        master_provider TEXT DEFAULT 'claude',
        status TEXT DEFAULT 'idle',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.prepare(`
      INSERT OR REPLACE INTO orchestration_sessions
      (id, session_id, user_id, config_json, master_provider, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      orchestration.id,
      orchestration.sessionId,
      orchestration.userId,
      JSON.stringify(orchestration.config),
      orchestration.config.master,
      'running',
      orchestration.startedAt?.toISOString()
    );
  }

  private updateOrchestrationStatus(sessionId: string, status: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE orchestration_sessions
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(status, sessionId);
  }

  private saveTask(orchestrationId: string, task: OrchestrationTask): void {
    const db = getDatabase();

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_tasks (
        id TEXT PRIMARY KEY,
        orchestration_id TEXT NOT NULL,
        worker_id TEXT,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        delegated_at DATETIME,
        completed_at DATETIME
      )
    `);

    db.prepare(`
      INSERT OR REPLACE INTO orchestration_tasks
      (id, orchestration_id, worker_id, description, status, result, error, created_at, delegated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      orchestrationId,
      task.workerId || null,
      task.description,
      task.status,
      task.result || null,
      task.error || null,
      task.createdAt,
      task.delegatedAt || null,
      task.completedAt || null
    );
  }

  private updateTask(orchestrationId: string, task: OrchestrationTask): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE orchestration_tasks
      SET worker_id = ?, status = ?, result = ?, error = ?, delegated_at = ?, completed_at = ?
      WHERE id = ? AND orchestration_id = ?
    `).run(
      task.workerId || null,
      task.status,
      task.result || null,
      task.error || null,
      task.delegatedAt || null,
      task.completedAt || null,
      task.id,
      orchestrationId
    );
  }
}

// Singleton instance
export const orchestrationManager = new OrchestrationManager();
