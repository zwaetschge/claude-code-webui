// ============================================================
// Ralph Wiggum - Autonomous Development Loop Types
// ============================================================

/** Status of a Ralph run */
export type RalphStatus = 'idle' | 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'stopped';

/** Status of a single task in the plan */
export type RalphTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/** A single task in the Ralph plan */
export interface RalphTask {
  id: string;
  index: number;
  title: string;
  description: string;
  status: RalphTaskStatus;
  attempts: number;
  lastError?: string;
  startedAt?: number;
  completedAt?: number;
}

/** The structured plan generated from user's idea */
export interface RalphPlan {
  id: string;
  title: string;
  description: string;
  tasks: RalphTask[];
  createdAt: number;
  updatedAt: number;
}

/** Single iteration record */
export interface RalphIteration {
  id: string;
  runId: string;
  taskId: string;
  iterationNumber: number;
  promptSent: string;
  responseReceived: boolean;
  toolCallCount: number;
  errorCount: number;
  completionDetected: boolean;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

/** Progress tracking */
export interface RalphProgress {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  currentTaskIndex: number;
  currentIteration: number;
  totalIterations: number;
  percentComplete: number;
}

/** Cost/token tracking for a Ralph run */
export interface RalphCostTracking {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

/** Circuit breaker state */
export interface RalphCircuitBreaker {
  noProgressCount: number;
  noProgressThreshold: number;
  sameErrorCount: number;
  sameErrorThreshold: number;
  lastError: string | null;
  triggered: boolean;
  triggerReason?: string;
}

/** Ralph run configuration */
export interface RalphConfig {
  /** Session ID to use (null = create new) */
  sessionId?: string;
  /** Working directory for new sessions */
  workingDirectory?: string;
  /** CLI provider (default: 'claude') */
  cliProvider?: string;
  /** Max iterations per task (default: 10) */
  maxIterationsPerTask: number;
  /** Max total iterations across all tasks (default: 50) */
  maxTotalIterations: number;
  /** Delay between iterations in ms (default: 2000) */
  iterationDelayMs: number;
  /** No-progress circuit breaker threshold (default: 3) */
  noProgressThreshold: number;
  /** Same-error circuit breaker threshold (default: 2) */
  sameErrorThreshold: number;
  /** Stop if cost exceeds this (USD) */
  maxCostUsd?: number;
  /** Stop if total tokens exceed this */
  maxTokens?: number;
  /** Skip all permissions (default: true) */
  dangerMode: boolean;
  /** Auto-create session if none provided (default: true) */
  autoCreateSession: boolean;
  /** Telegram notification on completion */
  notifyOnCompletion: boolean;
  /** Telegram notification on pause/circuit-break */
  notifyOnPause: boolean;
}

/** Default configuration */
export const DEFAULT_RALPH_CONFIG: RalphConfig = {
  maxIterationsPerTask: 10,
  maxTotalIterations: 50,
  iterationDelayMs: 2000,
  noProgressThreshold: 3,
  sameErrorThreshold: 2,
  dangerMode: true,
  autoCreateSession: true,
  notifyOnCompletion: true,
  notifyOnPause: true,
};

/** Complete Ralph run state */
export interface RalphRunState {
  id: string;
  sessionId: string;
  userId: string;
  config: RalphConfig;
  status: RalphStatus;
  plan: RalphPlan | null;
  progress: RalphProgress;
  circuitBreaker: RalphCircuitBreaker;
  costTracking: RalphCostTracking;
  iterations: RalphIteration[];
  createdAt: number;
  startedAt?: number;
  pausedAt?: number;
  completedAt?: number;
  lastError?: string;
  exitReason?: string;
  /** Original user idea */
  idea: string;
}
