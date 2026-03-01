import { nanoid } from "nanoid";
import type {
  DelegatedTaskStatus,
  DelegatedTaskType,
  DelegatedTaskInfo,
  DelegatedTaskSubmitRequest,
  DelegatedTaskSubmitResponse,
} from "@claude-code-webui/shared";

export interface TaskRunner {
  taskType: string;
  execute(
    taskId: string,
    params: Record<string, unknown>,
    ctx: TaskContext
  ): Promise<unknown>;
  cancel?(taskId: string): void;
  handleInput?(taskId: string, data: unknown): void;
}

export interface TaskContext {
  setProgress(msg: string): void;
  setResult(result: unknown): void;
  setStatus(status: DelegatedTaskStatus): void;
}

interface InternalTask {
  id: string;
  taskType: DelegatedTaskType;
  status: DelegatedTaskStatus;
  progress?: string;
  result?: unknown;
  error?: string;
  requestedBy: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  waiters: Array<() => void>;
}

const TASK_TTL_MS = 30 * 60 * 1000; // 30 min

export class TaskManager {
  private tasks = new Map<string, InternalTask>();
  private runners = new Map<string, TaskRunner>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  registerRunner(runner: TaskRunner): void {
    this.runners.set(runner.taskType, runner);
  }

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  submit(req: DelegatedTaskSubmitRequest): DelegatedTaskSubmitResponse {
    const runner = this.runners.get(req.taskType);
    if (!runner) {
      throw new Error(`No runner registered for task type: ${req.taskType}`);
    }

    const now = Date.now();
    const id = nanoid();
    const task: InternalTask = {
      id,
      taskType: req.taskType,
      status: "queued",
      requestedBy: req.requestedBy,
      createdAt: now,
      waiters: [],
    };

    this.tasks.set(id, task);

    // Start execution async
    setImmediate(() => this.executeTask(task, runner, req.params));

    return {
      taskId: id,
      status: "queued",
      createdAt: new Date(now).toISOString(),
    };
  }

  getTask(taskId: string): DelegatedTaskInfo | null {
    const task = this.tasks.get(taskId);
    return task ? this.toInfo(task) : null;
  }

  async pollTask(taskId: string, timeoutMs = 30_000): Promise<DelegatedTaskInfo | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // If already in a terminal/awaiting state, return immediately
    if (task.status !== "queued" && task.status !== "running") {
      return this.toInfo(task);
    }

    // Wait for a status change
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const idx = task.waiters.indexOf(notify);
        if (idx >= 0) task.waiters.splice(idx, 1);
        resolve();
      }, timeoutMs);

      const notify = () => {
        clearTimeout(timer);
        resolve();
      };
      task.waiters.push(notify);
    });

    return this.toInfo(task);
  }

  sendInput(taskId: string, data: unknown): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "awaiting_input") return false;

    const runner = this.runners.get(task.taskType);
    if (!runner?.handleInput) return false;

    runner.handleInput(taskId, data);
    return true;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const runner = this.runners.get(task.taskType);
    runner?.cancel?.(taskId);

    task.status = "cancelled";
    task.completedAt = Date.now();
    this.notifyWaiters(task);
    return true;
  }

  listTasks(filter?: { status?: string; taskType?: string }): DelegatedTaskInfo[] {
    const results: DelegatedTaskInfo[] = [];
    for (const task of this.tasks.values()) {
      if (filter?.status && task.status !== filter.status) continue;
      if (filter?.taskType && task.taskType !== filter.taskType) continue;
      results.push(this.toInfo(task));
    }
    return results;
  }

  private async executeTask(
    task: InternalTask,
    runner: TaskRunner,
    params: Record<string, unknown>
  ): Promise<void> {
    task.status = "running";
    task.startedAt = Date.now();
    this.notifyWaiters(task);

    const ctx: TaskContext = {
      setProgress: (msg) => {
        task.progress = msg;
        this.notifyWaiters(task);
      },
      setResult: (result) => {
        task.result = result;
        this.notifyWaiters(task);
      },
      setStatus: (status) => {
        task.status = status;
        this.notifyWaiters(task);
      },
    };

    try {
      const result = await runner.execute(task.id, params, ctx);
      if (task.status === "running" || task.status === "awaiting_input") {
        task.status = "completed";
        task.result = result ?? task.result;
      }
    } catch (err) {
      // cancelTask() may have set status externally during execution
      if ((task.status as DelegatedTaskStatus) !== "cancelled") {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      task.completedAt = Date.now();
      this.notifyWaiters(task);
    }
  }

  private notifyWaiters(task: InternalTask): void {
    if (task.waiters.length > 0) {
      task.waiters.splice(0).forEach((fn) => fn());
    }
  }

  private toInfo(task: InternalTask): DelegatedTaskInfo {
    return {
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      progress: task.progress,
      result: task.result,
      error: task.error,
      requestedBy: task.requestedBy,
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : undefined,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (now - task.createdAt > TASK_TTL_MS) {
        const runner = this.runners.get(task.taskType);
        runner?.cancel?.(id);
        this.tasks.delete(id);
      }
    }
  }
}
