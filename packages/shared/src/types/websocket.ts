import type { Message, StreamingMessage } from './message';
import type { SessionStatus, CLIProvider } from './session';
import type { SelfRebuildStatus } from './self-rebuild';
import type {
  OrchestrationConfig,
  OrchestrationState,
  OrchestrationTask,
  OrchestrationPhase,
  WorkerState,
  TaskResult,
} from './orchestration';
import type {
  RalphRunState,
  RalphProgress,
  RalphIteration,
  RalphPlan,
  RalphConfig,
} from './ralph';

// Session permission mode
export type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger' | 'orchestration';

// File attachment data for sending to Claude (images, text, pdf, etc.)
export interface FileAttachmentData {
  data: string; // base64 encoded
  mimeType: string;
  filename?: string; // original filename for non-image files
}

// Alias for backwards compatibility
export type ImageAttachmentData = FileAttachmentData;

// Buffered message for reconnection replay
export interface BufferedMessage {
  type: 'output' | 'message' | 'thinking' | 'tool_use' | 'usage' | 'todos' | 'agent' | 'image' | 'status' | 'mode';
  data: unknown;
  timestamp: number;
}

// Permission response action type
export type PermissionAction = 'allow_once' | 'allow_project' | 'allow_global' | 'deny';

// Client to Server Events
export interface ClientToServerEvents {
  'session:send': (data: {
    sessionId: string;
    message: string;
    images?: ImageAttachmentData[];
  }) => void;
  'session:input': (data: {
    sessionId: string;
    input: string;
  }) => void;
  'session:subscribe': (sessionId: string) => void;
  'session:unsubscribe': (sessionId: string) => void;
  'session:interrupt': (sessionId: string) => void;
  'session:restart': (sessionId: string) => void;
  'session:reconnect': (data: {
    sessionId: string;
    lastTimestamp?: number;
  }) => void;
  'session:generate-image': (data: {
    sessionId: string;
    prompt: string;
    model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';
    referenceImages?: string[];
  }) => void;
  'session:set-mode': (data: {
    sessionId: string;
    mode: SessionMode;
  }) => void;
  // Legacy permission events (for simple approve/deny flow)
  'session:approve_permission': (data: {
    sessionId: string;
    toolNames: string[]; // Tools to allow
    originalMessage: string; // The message to resend
  }) => void;
  'session:deny_permission': (data: {
    sessionId: string;
  }) => void;
  // New hooks-based permission event (for finer control)
  'session:permission_respond': (data: {
    sessionId: string;
    requestId: string;
    action: PermissionAction;
    pattern?: string;
  }) => void;
  // Orchestration events
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
  // Ralph autonomous loop events
  'ralph:start': (data: {
    sessionId?: string;
    idea: string;
    config?: Partial<RalphConfig>;
  }) => void;
  'ralph:pause': (data: { runId: string }) => void;
  'ralph:resume': (data: { runId: string }) => void;
  'ralph:stop': (data: { runId: string }) => void;
}

// Usage data from Claude CLI
export interface UsageData {
  sessionId: string;
  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  // Context window
  contextWindow: number;
  contextUsedPercent: number;
  // Cost
  totalCostUsd: number;
  // Model info
  model: string;
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Tool execution record for display
export interface ToolExecution {
  toolId: string;
  toolName: string;
  status: 'started' | 'completed' | 'error';
  input?: unknown;
  result?: string;
  error?: string;
  timestamp: number;
  completedAt?: number;
}

// Pending permission request from Claude (hooks-based)
export interface PendingPermission {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
}

// Generated image data
export interface GeneratedImageData {
  sessionId: string;
  imagePath: string;
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'gemini' | 'other';
}

// Permission denial data (when Claude tries to use a tool without permission)
export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

// Permission request event data (legacy flow)
export interface PermissionRequestData {
  sessionId: string;
  denials: PermissionDenial[];
  originalMessage: string; // The message that triggered the permission request
}

// Server to Client Events
export interface ServerToClientEvents {
  'session:output': (data: StreamingMessage) => void;
  'session:message': (data: Message) => void;
  'session:status': (data: { sessionId: string; status: SessionStatus }) => void;
  'session:error': (data: { sessionId: string; error: string }) => void;
  'session:tool_use': (data: {
    sessionId: string;
    toolName: string;
    status: 'started' | 'completed' | 'error';
    toolId?: string;
    input?: unknown;
    result?: string;
    error?: string;
  }) => void;
  'session:agent': (data: {
    sessionId: string;
    agentType: string;
    description?: string;
    status: 'started' | 'completed' | 'error';
  }) => void;
  'session:thinking': (data: { sessionId: string; isThinking: boolean; message?: string }) => void;
  'session:todos': (data: { sessionId: string; todos: TodoItem[] }) => void;
  'session:usage': (data: UsageData) => void;
  'session:image': (data: GeneratedImageData) => void;
  'session:reconnected': (data: {
    sessionId: string;
    bufferedMessages: BufferedMessage[];
    isRunning: boolean;
  }) => void;
  'session:compact': (data: {
    sessionId: string;
    message: string;
    summary?: string;
    clear?: boolean;
    reason?: 'auto-compact' | 'provider-switch' | 'context-limit';
    error?: string;
  }) => void;
  'session:mode': (data: { sessionId: string; mode: SessionMode }) => void;
  // Legacy permission request (simple denials flow)
  'session:permission_request': (data: PermissionRequestData | PendingPermission) => void;
  // Self-rebuild status updates
  'self-rebuild:status': (data: SelfRebuildStatus & { completedAt?: string }) => void;
  // Orchestration events
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
  // Ralph autonomous loop events
  // Watchdog inter-instance communication
  'watchdog:inter_message': (data: import('./watchdog').WatchdogInterMessage) => void;
  // Ralph autonomous loop events
  'ralph:state': (data: { sessionId: string; run: RalphRunState }) => void;
  'ralph:progress': (data: { sessionId: string; runId: string; progress: RalphProgress }) => void;
  'ralph:iteration': (data: { sessionId: string; runId: string; iteration: RalphIteration }) => void;
  'ralph:plan': (data: { sessionId: string; runId: string; plan: RalphPlan }) => void;
  'ralph:completed': (data: { sessionId: string; runId: string; exitReason: string }) => void;
  'ralph:error': (data: { sessionId: string; runId: string; error: string }) => void;
  error: (message: string) => void;
}

// Inter-server Events (for scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Socket Data
export interface SocketData {
  userId: string;
  subscribedSessions: Set<string>;
}
