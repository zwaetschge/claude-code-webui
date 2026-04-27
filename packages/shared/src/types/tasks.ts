/** Inter-container task delegation types */

export type DelegatedTaskStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "completed"
  | "error"
  | "cancelled";

export type DelegatedTaskType = "run-script" | (string & {});

export interface DelegatedTaskInfo {
  taskId: string;
  taskType: DelegatedTaskType;
  status: DelegatedTaskStatus;
  progress?: string;
  result?: unknown;
  error?: string;
  requestedBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DelegatedTaskSubmitRequest {
  taskType: DelegatedTaskType;
  params: Record<string, unknown>;
  callbackUrl?: string;
  requestedBy: string;
}

export interface DelegatedTaskSubmitResponse {
  taskId: string;
  status: "queued";
  createdAt: string;
}

export interface DelegatedTaskDelegateRequest {
  taskType: DelegatedTaskType;
  params: Record<string, unknown>;
  target: string;
}

export interface DelegatedTaskInputRequest {
  data: unknown;
}

