export interface SelfRebuildRequest {
  noCache?: boolean;
}

export type SelfRebuildStatusType = 'idle' | 'building' | 'restarting' | 'error';

export interface SelfRebuildStatus {
  status: SelfRebuildStatusType;
  progress?: string;
  startedAt?: string;
  error?: string;
}

export interface SelfRebuildTriggerResponse {
  success: boolean;
  message: string;
}

export interface SelfRebuildPersistedStatus {
  status: SelfRebuildStatusType;
  progress?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  triggeredAt?: string;
  buildOutput?: string;
}
