import type { Message, StreamingMessage } from './message.js';
import type { SessionStatus } from './session.js';

// Session permission mode
export type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger';

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
  type:
    | 'output'
    | 'message'
    | 'thinking'
    | 'tool_use'
    | 'usage'
    | 'todos'
    | 'agent'
    | 'image'
    | 'compact'
    | 'status'
    | 'mode';
  data: unknown;
  timestamp: number;
}

export interface SessionQueueItem {
  id: string;
  preview: string;
  createdAt: string;
  attachments?: number;
}

export interface SessionQueueData {
  sessionId: string;
  provider: string;
  depth: number;
  items: SessionQueueItem[];
  busy?: boolean;
  preempting?: boolean;
}

// Permission response action type
export type PermissionAction = 'allow_once' | 'allow_project' | 'allow_global' | 'deny';

// Client to Server Events
export interface ClientToServerEvents {
  'session:send': (data: {
    sessionId: string;
    message: string;
    images?: ImageAttachmentData[];
    /**
     * Optional client-generated unique ID (e.g. nanoid/uuid) used to dedupe retries.
     * If the server has recently seen the same ID on this socket, the resend is dropped.
     */
    clientMessageId?: string;
  }) => void;
  'session:input': (data: { sessionId: string; input: string }) => void;
  'session:subscribe': (sessionId: string) => void;
  'session:unsubscribe': (sessionId: string) => void;
  'session:interrupt': (sessionId: string) => void;
  'session:restart': (sessionId: string) => void;
  'session:reconnect': (data: { sessionId: string; lastTimestamp?: number }) => void;
  'session:set-mode': (data: { sessionId: string; mode: SessionMode }) => void;
  // Legacy permission events (for simple approve/deny flow)
  'session:approve_permission': (data: {
    sessionId: string;
    toolNames: string[]; // Tools to allow
    originalMessage: string; // The message to resend
  }) => void;
  'session:deny_permission': (data: { sessionId: string }) => void;
  // New hooks-based permission event (for finer control)
  'session:permission_respond': (data: {
    sessionId: string;
    requestId: string;
    action: PermissionAction;
    pattern?: string;
  }) => void;
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
  contextUsedPercentRaw?: number;
  contextExceeded?: boolean;
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
  generator: 'opencode' | 'other';
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
    /**
     * Backend-clock timestamp at the moment of emission. Frontend should
     * prefer this over its own Date.now() so the chat timeline orders tools
     * against assistant messages (which are also stamped with the backend
     * clock) regardless of browser/server clock skew.
     */
    timestamp?: number;
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
    /** True when buffer rolled over since lastTimestamp — client should full-resync from REST. */
    needsFullResync?: boolean;
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
  'session:queue': (data: SessionQueueData) => void;
  // Legacy permission request (simple denials flow)
  'session:permission_request': (data: PermissionRequestData | PendingPermission) => void;
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
