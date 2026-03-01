import type { CLIProvider } from './session';

// Worker configuration for orchestration
export interface WorkerConfig {
  provider: CLIProvider;
  maxConcurrent: number;
  specialization?: string;
  enabled: boolean;
}

// Orchestration configuration
export interface OrchestrationConfig {
  master: CLIProvider; // Always 'claude' as orchestrator
  workers: WorkerConfig[];
  taskRouting: 'auto' | 'manual';
  parallelExecution: boolean;
  maxParallelTasks: number;
}

// Default orchestration config
export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  master: 'claude',
  workers: [
    { provider: 'codex', maxConcurrent: 1, specialization: 'reasoning', enabled: true },
    { provider: 'gemini', maxConcurrent: 1, specialization: 'frontend', enabled: true },
    { provider: 'glm', maxConcurrent: 1, specialization: 'quick', enabled: false },
  ],
  taskRouting: 'auto',
  parallelExecution: true,
  maxParallelTasks: 3,
};

// Task priority levels
export type TaskPriority = 'high' | 'normal' | 'low';

// Task status
export type OrchestrationTaskStatus = 'pending' | 'delegated' | 'running' | 'completed' | 'failed' | 'cancelled';

// Task delegation from orchestrator to worker
export interface TaskDelegation {
  taskId: string;
  workerType: CLIProvider;
  task: string;
  context: string;
  priority: TaskPriority;
  createdAt: string;
}

// Result from a worker
export interface TaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  result: string;
  error?: string;
  duration: number;
  completedAt: string;
}

// Worker status
export type WorkerStatus = 'idle' | 'starting' | 'busy' | 'error' | 'stopped';

// Worker state
export interface WorkerState {
  id: string;
  provider: CLIProvider;
  status: WorkerStatus;
  currentTaskId?: string;
  currentTask?: string;
  lastActivity?: string;
  errorMessage?: string;
}

// Orchestration task (for tracking)
export interface OrchestrationTask {
  id: string;
  orchestrationId: string;
  workerId?: string;
  description: string;
  status: OrchestrationTaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  delegatedAt?: string;
  completedAt?: string;
}

// Orchestration phase
export type OrchestrationPhase =
  | 'idle'
  | 'analyzing'
  | 'delegating'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'error';

// Overall orchestration state
export interface OrchestrationState {
  sessionId: string;
  isOrchestrating: boolean;
  config: OrchestrationConfig;
  workers: WorkerState[];
  tasks: OrchestrationTask[];
  currentPhase: OrchestrationPhase;
  phaseMessage?: string;
  startedAt?: string;
  completedAt?: string;
}

// Task routing rule
export interface TaskRoutingRule {
  pattern: RegExp | string;
  provider: CLIProvider;
  description: string;
}

// Orchestration session (DB model)
export interface OrchestrationSession {
  id: string;
  sessionId: string;
  configJson: string;
  masterProvider: CLIProvider;
  status: 'idle' | 'running' | 'completed' | 'error';
  createdAt: string;
  updatedAt: string;
}

// Orchestration worker (DB model)
export interface OrchestrationWorker {
  id: string;
  orchestrationId: string;
  provider: CLIProvider;
  status: WorkerStatus;
  currentTaskId?: string;
  lastActivityAt?: string;
}

// Orchestration task (DB model)
export interface OrchestrationTaskRecord {
  id: string;
  orchestrationId: string;
  workerId?: string;
  description: string;
  status: OrchestrationTaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  delegatedAt?: string;
  completedAt?: string;
}

// WebSocket Events for Orchestration

// Server -> Client Events
export interface OrchestrationServerEvents {
  'orchestration:state': (data: OrchestrationState) => void;
  'orchestration:task_delegated': (data: {
    sessionId: string;
    task: OrchestrationTask;
    worker: WorkerState;
  }) => void;
  'orchestration:task_progress': (data: {
    sessionId: string;
    taskId: string;
    workerId: string;
    content: string;
    isPartial: boolean;
  }) => void;
  'orchestration:task_completed': (data: {
    sessionId: string;
    task: OrchestrationTask;
    result: TaskResult;
  }) => void;
  'orchestration:worker_status': (data: {
    sessionId: string;
    worker: WorkerState;
  }) => void;
  'orchestration:worker_output': (data: {
    sessionId: string;
    workerId: string;
    provider: CLIProvider;
    content: string;
    isPartial: boolean;
  }) => void;
  'orchestration:phase': (data: {
    sessionId: string;
    phase: OrchestrationPhase;
    message?: string;
  }) => void;
  'orchestration:error': (data: {
    sessionId: string;
    error: string;
    taskId?: string;
    workerId?: string;
  }) => void;
}

// Client -> Server Events
export interface OrchestrationClientEvents {
  'orchestration:configure': (data: {
    sessionId: string;
    config: Partial<OrchestrationConfig>;
  }) => void;
  'orchestration:start': (data: {
    sessionId: string;
  }) => void;
  'orchestration:stop': (data: {
    sessionId: string;
  }) => void;
  'orchestration:interrupt_worker': (data: {
    sessionId: string;
    workerId: string;
  }) => void;
  'orchestration:cancel_task': (data: {
    sessionId: string;
    taskId: string;
  }) => void;
  'orchestration:retry_task': (data: {
    sessionId: string;
    taskId: string;
  }) => void;
}
