import type { CLIProvider } from './session.js';

export type DockerHealthState = 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';

export interface DockerIntegrationStatus {
  enabled: boolean;
  available: boolean;
  serverVersion: string | null;
  socketPath: string;
  error: string | null;
}

export interface DockerPortBinding {
  privatePort?: number;
  publicPort?: number;
  type?: string;
  ip?: string;
  raw?: string;
}

export interface DockerMountSummary {
  type?: string;
  source?: string;
  destination?: string;
  mode?: string;
  rw?: boolean;
}

export interface DockerContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageId?: string | null;
  command?: string | null;
  state: string;
  status: string;
  health: DockerHealthState;
  createdAt?: string | null;
  runningFor?: string | null;
  ports: DockerPortBinding[];
  networks: string[];
  mounts: DockerMountSummary[];
  composeProject?: string | null;
  composeService?: string | null;
}

export interface DockerContainerDetail extends DockerContainerSummary {
  startedAt?: string | null;
  finishedAt?: string | null;
  restartCount?: number;
  restartPolicy?: string | null;
  labels: Record<string, string>;
  appdataCandidates: string[];
}

export interface DockerContainerStats {
  containerId: string;
  name: string;
  cpuPercentText?: string;
  memoryUsageText?: string;
  memoryPercentText?: string;
  networkIoText?: string;
  blockIoText?: string;
  pids?: string;
  sampledAt: string;
}

export interface DockerContainerLogs {
  containerId: string;
  tail: number;
  lines: string[];
  truncated: boolean;
  capturedAt: string;
}

export interface ContainerHealthSnapshot {
  id: string;
  watchdogId: string | null;
  containerId: string;
  state: string;
  health: DockerHealthState;
  restartCount: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  summary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export type WatchdogAutonomyLevel = 'observe' | 'diagnose' | 'propose' | 'approved-action';

export interface ContainerWatchdog {
  id: string;
  userId: string;
  containerId: string;
  containerName: string;
  sessionId: string;
  sessionName: string;
  sessionProvider: CLIProvider;
  enabled: boolean;
  autonomyLevel: WatchdogAutonomyLevel;
  lastSnapshotAt: string | null;
  lastIncidentAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPeerProfile {
  sessionId: string;
  alias: string;
  description: string | null;
  enabled: boolean;
  visibility: 'private' | 'user';
  inboxPolicy: 'queue';
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionPeerLink {
  id: string;
  userId: string;
  sourceSessionId: string;
  targetSessionId: string;
  role: string | null;
  enabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  target: {
    id: string;
    name: string;
    workingDirectory: string;
    cliProvider: CLIProvider;
    cliModel: string | null;
    mode: string | null;
    status: string;
    lastMessage: string | null;
    updatedAt: string;
  };
}

export type SessionDelegationStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface SessionDelegation {
  id: string;
  threadId: string;
  correlationId: string;
  userId: string;
  fromSessionId: string | null;
  toSessionId: string;
  fromActor: string;
  kind: 'message' | 'consult' | 'watchdog-consult';
  status: SessionDelegationStatus;
  content: string;
  result: string | null;
  error: string | null;
  hopCount: number;
  expiresAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  fromSessionName?: string | null;
  toSessionName?: string | null;
}
