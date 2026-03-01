// Watchdog configuration types

export interface WatchdogRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // Lower = higher priority
  condition: WatchdogCondition;
  action: WatchdogAction;
}

export type WatchdogCondition =
  | { type: 'tool_match'; toolName: string; pattern?: string }
  | { type: 'tool_any' }
  | { type: 'error_count'; threshold: number; windowMinutes: number }
  | { type: 'token_usage'; threshold: number }
  | { type: 'time_elapsed'; minutes: number }
  | { type: 'always' };

export type WatchdogAction =
  | { type: 'approve'; savePattern?: 'project' | 'global' }
  | { type: 'deny'; reason?: string }
  | { type: 'pause'; reason?: string }
  | { type: 'notify'; webhook?: string; message?: string };

export type WatchdogAutonomousProfile = 'balanced' | 'aggressive';

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnApprove: boolean;
  notifyOnDeny: boolean;
  notifyOnPause: boolean;
  notifyOnError: boolean;
  notifyOnGoalProgress: boolean;
}

export interface SessionGoal {
  id: string;
  sessionId: string;
  description: string;
  constraints?: string;
  successCriteria?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  progress?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  // Active monitoring fields
  autoMonitor: boolean;
  maxIterations?: number;
  iterationCount: number;
  lastEvaluation?: string;
  lastEvaluationAt?: number;
  originalMessage?: string;
}

export interface GoalMonitoringConfig {
  enabled: boolean;
  maxIterationsPerGoal: number;
  evaluationDelayMs: number;
  autoCreateFromSession: boolean;
}

export interface WatchdogSessionState {
  sessionId: string;
  monitored: boolean;
  goals: SessionGoal[];
  lastActivity: number;
  errorCount: number;
  tokenUsage: number;
  startTime: number;
  paused: boolean;
  pauseReason?: string;
}

export interface WatchdogCliConfig {
  enabled: boolean;
  cliProvider: string;
  model?: string;
  workingDirectory?: string;
  sessionId?: string;
  useForPermissions: boolean;
  useForChat: boolean;
  permissionTimeoutMs?: number;
}

export interface WatchdogConfig {
  enabled: boolean;
  sessionId?: string;
  autonomousProfile?: WatchdogAutonomousProfile;
  rules: WatchdogRule[];
  pauseOnErrorThreshold?: number;
  maxTokensPerSession?: number;
  maxRuntimeMinutes?: number;
  notifyWebhook?: string;
  logDecisions: boolean;
  telegram?: TelegramConfig;
  cli?: WatchdogCliConfig;
  goalMonitoring?: GoalMonitoringConfig;
}

export interface WatchdogDecision {
  id: string;
  timestamp: number;
  sessionId: string;
  requestId?: string;
  toolName: string;
  toolInput?: unknown;
  rule?: WatchdogRule;
  action: WatchdogAction['type'];
  reason: string;
  automatic: boolean;
}

export interface WatchdogStatus {
  enabled: boolean;
  autonomousProfile?: WatchdogAutonomousProfile;
  activeRules: number;
  decisionsToday: number;
  lastDecision?: WatchdogDecision;
  pausedSessions: string[];
  monitoredSessions: WatchdogSessionState[];
  telegramConnected: boolean;
}

export interface WatchdogChatMessage {
  id: string;
  role: 'user' | 'watchdog';
  content: string;
  timestamp: number;
  sessionId?: string;
}

export type WatchdogInterSource = 'watchdog' | 'session' | 'ralph';

export interface WatchdogInterMessage {
  id: string;
  timestamp: number;
  from: WatchdogInterSource;
  fromSessionId?: string;
  to: WatchdogInterSource;
  toSessionId?: string;
  toRunId?: string;
  content: string;
  response?: string;
  type: 'guidance' | 'query' | 'response' | 'alert' | 'status';
}

export interface SessionActivityEntry {
  sessionId: string;
  timestamp: number;
  type: 'message' | 'tool' | 'error' | 'status';
  summary: string;
}

export const DEFAULT_WATCHDOG_RULES: WatchdogRule[] = [
  {
    id: 'auto-approve-read',
    name: 'Auto-approve file reads',
    enabled: true,
    priority: 10,
    condition: { type: 'tool_match', toolName: 'Read' },
    action: { type: 'approve' },
  },
  {
    id: 'auto-approve-glob',
    name: 'Auto-approve file search',
    enabled: true,
    priority: 10,
    condition: { type: 'tool_match', toolName: 'Glob' },
    action: { type: 'approve' },
  },
  {
    id: 'auto-approve-grep',
    name: 'Auto-approve code search',
    enabled: true,
    priority: 10,
    condition: { type: 'tool_match', toolName: 'Grep' },
    action: { type: 'approve' },
  },
  {
    id: 'auto-approve-git-safe',
    name: 'Auto-approve safe git commands',
    enabled: true,
    priority: 20,
    condition: { type: 'tool_match', toolName: 'Bash', pattern: 'git status:*' },
    action: { type: 'approve' },
  },
  {
    id: 'auto-approve-git-diff',
    name: 'Auto-approve git diff',
    enabled: true,
    priority: 20,
    condition: { type: 'tool_match', toolName: 'Bash', pattern: 'git diff:*' },
    action: { type: 'approve' },
  },
  {
    id: 'auto-approve-git-log',
    name: 'Auto-approve git log',
    enabled: true,
    priority: 20,
    condition: { type: 'tool_match', toolName: 'Bash', pattern: 'git log:*' },
    action: { type: 'approve' },
  },
  {
    id: 'deny-dangerous-rm',
    name: 'Deny dangerous rm commands',
    enabled: true,
    priority: 1,
    condition: { type: 'tool_match', toolName: 'Bash', pattern: 'rm -rf /:*' },
    action: { type: 'deny', reason: 'Dangerous rm command blocked by watchdog' },
  },
  {
    id: 'deny-sudo',
    name: 'Deny sudo commands',
    enabled: true,
    priority: 1,
    condition: { type: 'tool_match', toolName: 'Bash', pattern: 'sudo:*' },
    action: { type: 'deny', reason: 'Sudo commands blocked by watchdog' },
  },
  {
    id: 'pause-on-errors',
    name: 'Pause after 5 consecutive errors',
    enabled: false,
    priority: 5,
    condition: { type: 'error_count', threshold: 5, windowMinutes: 10 },
    action: { type: 'pause', reason: 'Too many errors - session paused by watchdog' },
  },
];
