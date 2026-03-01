/**
 * WorkerProcessManager - Manages worker CLI processes for orchestration
 *
 * Spawns and manages CLI processes (Codex, Gemini, GLM) that act as workers
 * for the orchestrator (Claude).
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import os from 'os';
import type { CLIProvider, WorkerState, WorkerStatus } from '@claude-code-webui/shared';
import { CLI_PROVIDERS, getCLIArgs, formatInputMessage } from '../cli-providers.js';

export interface WorkerProcess {
  id: string;
  sessionId: string;
  provider: CLIProvider;
  process: ChildProcess;
  status: WorkerStatus;
  currentTaskId?: string;
  buffer: string;
  outputBuffer: string[];
  createdAt: Date;
  lastActivityAt: Date;
}

export interface WorkerOutput {
  workerId: string;
  provider: CLIProvider;
  content: string;
  isPartial: boolean;
  isError: boolean;
}

export interface WorkerEvents {
  output: (data: WorkerOutput) => void;
  status: (workerId: string, status: WorkerStatus, error?: string) => void;
  taskComplete: (workerId: string, taskId: string, result: string, success: boolean, error?: string) => void;
  error: (workerId: string, error: Error) => void;
}

export class WorkerProcessManager extends EventEmitter {
  private workers: Map<string, WorkerProcess> = new Map();
  private sessionWorkers: Map<string, Set<string>> = new Map(); // sessionId -> workerIds
  private workerTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes idle timeout

  constructor() {
    super();
  }

  /**
   * Spawn a new worker process
   */
  async spawnWorker(
    sessionId: string,
    provider: CLIProvider,
    workingDirectory: string,
    _userId: string
  ): Promise<WorkerProcess> {
    // Don't spawn claude/multi as workers - they are orchestrators
    if (provider === 'claude' || provider === 'multi') {
      throw new Error(`Cannot spawn ${provider} as a worker - it is an orchestrator`);
    }

    const workerId = `worker-${provider}-${nanoid(8)}`;
    const providerConfig = CLI_PROVIDERS[provider];

    if (!providerConfig) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    console.log(`[WORKER] Spawning ${provider} worker ${workerId} for session ${sessionId}`);

    // Build CLI args for the worker (using orchestration mode for automatic approval)
    const args = getCLIArgs(provider, {
      mode: 'orchestration',
      workingDirectory,
    });

    // Provider-specific environment setup
    const extraEnv: Record<string, string> = {};

    if (provider === 'codex') {
      const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
      extraEnv.CODEX_HOME = codexHome;
    }

    // Spawn the process
    const proc = spawn(providerConfig.command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...extraEnv,
        WEBUI_WORKER_ID: workerId,
        WEBUI_SESSION_ID: sessionId,
        WEBUI_IS_WORKER: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const worker: WorkerProcess = {
      id: workerId,
      sessionId,
      provider,
      process: proc,
      status: 'starting',
      buffer: '',
      outputBuffer: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.workers.set(workerId, worker);

    // Track workers by session
    if (!this.sessionWorkers.has(sessionId)) {
      this.sessionWorkers.set(sessionId, new Set());
    }
    this.sessionWorkers.get(sessionId)!.add(workerId);

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      this.handleWorkerOutput(workerId, data.toString(), false);
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      this.handleWorkerOutput(workerId, data.toString(), true);
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      console.log(`[WORKER] ${workerId} exited with code ${code}, signal ${signal}`);
      this.handleWorkerExit(workerId, code, signal);
    });

    // Handle process error
    proc.on('error', (err) => {
      console.error(`[WORKER] ${workerId} error:`, err);
      this.emit('error', workerId, err);
      this.updateWorkerStatus(workerId, 'error', err.message);
    });

    // Wait for worker to be ready
    await this.waitForWorkerReady(workerId);

    return worker;
  }

  /**
   * Wait for a worker to be ready (initial startup)
   */
  private async waitForWorkerReady(workerId: string, timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = this.workers.get(workerId);
      if (!worker) {
        reject(new Error(`Worker ${workerId} not found`));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} startup timeout`));
      }, timeoutMs);

      // Consider worker ready after first output or after a short delay
      const checkReady = () => {
        if (worker.status === 'error') {
          clearTimeout(timeout);
          reject(new Error(`Worker ${workerId} failed to start`));
          return;
        }
        if (worker.outputBuffer.length > 0 || worker.status === 'idle') {
          clearTimeout(timeout);
          this.updateWorkerStatus(workerId, 'idle');
          resolve();
          return;
        }
      };

      // Check periodically
      const interval = setInterval(() => {
        checkReady();
      }, 100);

      // Also resolve after 2 seconds if process is running
      setTimeout(() => {
        clearInterval(interval);
        clearTimeout(timeout);
        if (worker.process && !worker.process.killed) {
          this.updateWorkerStatus(workerId, 'idle');
          resolve();
        }
      }, 2000);
    });
  }

  /**
   * Handle output from a worker
   */
  private handleWorkerOutput(workerId: string, data: string, isError: boolean): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.lastActivityAt = new Date();
    worker.buffer += data;
    this.resetWorkerTimeout(workerId);

    // Try to parse complete JSON lines
    const lines = worker.buffer.split('\n');
    worker.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      // Store raw output
      worker.outputBuffer.push(line);

      // Emit output event
      this.emit('output', {
        workerId,
        provider: worker.provider,
        content: line,
        isPartial: false,
        isError,
      } as WorkerOutput);

      // Try to parse as JSON for structured data
      try {
        const parsed = JSON.parse(line);
        this.handleParsedOutput(workerId, parsed);
      } catch {
        // Not JSON, treat as raw output
      }
    }
  }

  /**
   * Handle parsed JSON output from worker
   */
  private handleParsedOutput(workerId: string, data: unknown): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    const obj = data as Record<string, unknown>;

    // Handle different output types based on provider
    if (worker.provider === 'codex') {
      // Codex JSONL format
      if (obj.type === 'message' && obj.role === 'assistant') {
        // Final response
        if (worker.currentTaskId) {
          const content = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
          this.emit('taskComplete', workerId, worker.currentTaskId, content, true);
          worker.currentTaskId = undefined;
          this.updateWorkerStatus(workerId, 'idle');
        }
      }
    } else if (worker.provider === 'gemini') {
      // Gemini stream-json format (similar to Claude)
      if (obj.type === 'result') {
        // Final result
        if (worker.currentTaskId) {
          const result = obj.result as Record<string, unknown>;
          const content = typeof result?.text === 'string' ? result.text : JSON.stringify(result);
          this.emit('taskComplete', workerId, worker.currentTaskId, content, true);
          worker.currentTaskId = undefined;
          this.updateWorkerStatus(workerId, 'idle');
        }
      }
    }
  }

  /**
   * Handle worker process exit
   */
  private handleWorkerExit(workerId: string, code: number | null, signal: string | null): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    // If worker was running a task, report it as failed
    if (worker.currentTaskId) {
      const error = `Worker exited unexpectedly (code: ${code}, signal: ${signal})`;
      this.emit('taskComplete', workerId, worker.currentTaskId, '', false, error);
    }

    this.updateWorkerStatus(workerId, 'stopped');
    this.cleanupWorker(workerId);
  }

  /**
   * Send a task to a worker
   */
  async sendTask(workerId: string, taskId: string, task: string, context?: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    if (worker.status !== 'idle') {
      throw new Error(`Worker ${workerId} is not idle (status: ${worker.status})`);
    }

    worker.currentTaskId = taskId;
    worker.outputBuffer = []; // Clear previous output
    this.updateWorkerStatus(workerId, 'busy');

    // Format the message with context
    const fullMessage = context
      ? `Context:\n${context}\n\nTask:\n${task}`
      : task;

    // Send to the worker's stdin
    const formattedInput = formatInputMessage(worker.provider, fullMessage);

    console.log(`[WORKER] Sending task ${taskId} to ${workerId}:`, task.substring(0, 100) + '...');

    worker.process.stdin?.write(formattedInput);
  }

  /**
   * Interrupt a worker's current task
   */
  interruptWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[WORKER] Interrupting ${workerId}`);

    // Send SIGINT to the process
    worker.process.kill('SIGINT');

    if (worker.currentTaskId) {
      this.emit('taskComplete', workerId, worker.currentTaskId, '', false, 'Task interrupted');
      worker.currentTaskId = undefined;
    }

    this.updateWorkerStatus(workerId, 'idle');
  }

  /**
   * Terminate a worker
   */
  terminateWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[WORKER] Terminating ${workerId}`);

    // Kill the process
    worker.process.kill('SIGTERM');

    // Force kill after timeout
    setTimeout(() => {
      if (!worker.process.killed) {
        worker.process.kill('SIGKILL');
      }
    }, 5000);

    this.cleanupWorker(workerId);
  }

  /**
   * Terminate all workers for a session
   */
  terminateSessionWorkers(sessionId: string): void {
    const workerIds = this.sessionWorkers.get(sessionId);
    if (!workerIds) return;

    console.log(`[WORKER] Terminating all workers for session ${sessionId}`);

    for (const workerId of workerIds) {
      this.terminateWorker(workerId);
    }

    this.sessionWorkers.delete(sessionId);
  }

  /**
   * Get worker state
   */
  getWorkerState(workerId: string): WorkerState | null {
    const worker = this.workers.get(workerId);
    if (!worker) return null;

    return {
      id: worker.id,
      provider: worker.provider,
      status: worker.status,
      currentTaskId: worker.currentTaskId,
      currentTask: undefined, // Would need to track this
      lastActivity: worker.lastActivityAt.toISOString(),
    };
  }

  /**
   * Get all workers for a session
   */
  getSessionWorkers(sessionId: string): WorkerState[] {
    const workerIds = this.sessionWorkers.get(sessionId);
    if (!workerIds) return [];

    const states: WorkerState[] = [];
    for (const workerId of workerIds) {
      const state = this.getWorkerState(workerId);
      if (state) states.push(state);
    }

    return states;
  }

  /**
   * Get an idle worker for a provider
   */
  getIdleWorker(sessionId: string, provider: CLIProvider): WorkerProcess | null {
    const workerIds = this.sessionWorkers.get(sessionId);
    if (!workerIds) return null;

    for (const workerId of workerIds) {
      const worker = this.workers.get(workerId);
      if (worker && worker.provider === provider && worker.status === 'idle') {
        return worker;
      }
    }

    return null;
  }

  /**
   * Update worker status
   */
  private updateWorkerStatus(workerId: string, status: WorkerStatus, error?: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.status = status;
    this.emit('status', workerId, status, error);
  }

  /**
   * Reset worker timeout
   */
  private resetWorkerTimeout(workerId: string): void {
    // Clear existing timeout
    const existing = this.workerTimeouts.get(workerId);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      const worker = this.workers.get(workerId);
      if (worker && worker.status === 'idle') {
        console.log(`[WORKER] ${workerId} idle timeout, terminating`);
        this.terminateWorker(workerId);
      }
    }, this.WORKER_TIMEOUT_MS);

    this.workerTimeouts.set(workerId, timeout);
  }

  /**
   * Cleanup worker resources
   */
  private cleanupWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    // Clear timeout
    const timeout = this.workerTimeouts.get(workerId);
    if (timeout) {
      clearTimeout(timeout);
      this.workerTimeouts.delete(workerId);
    }

    // Remove from session workers
    const sessionWorkers = this.sessionWorkers.get(worker.sessionId);
    if (sessionWorkers) {
      sessionWorkers.delete(workerId);
      if (sessionWorkers.size === 0) {
        this.sessionWorkers.delete(worker.sessionId);
      }
    }

    // Remove worker
    this.workers.delete(workerId);
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): WorkerProcess | null {
    return this.workers.get(workerId) || null;
  }

  /**
   * Check if workers exist for a session
   */
  hasWorkers(sessionId: string): boolean {
    return this.sessionWorkers.has(sessionId) && this.sessionWorkers.get(sessionId)!.size > 0;
  }
}

// Singleton instance
export const workerProcessManager = new WorkerProcessManager();
