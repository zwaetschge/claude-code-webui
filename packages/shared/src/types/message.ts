export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageImage {
  path: string;
  filename: string;
}

export interface MessageAttachment {
  path: string;
  filename: string;
  mimeType: string;
  type: 'image' | 'text' | 'pdf' | 'document';
}

export type ChatMediaSource = 'provider' | 'workspace' | 'comfyui' | 'user';

/**
 * Persisted chat media exposed to clients. Storage keys and host filesystem
 * paths intentionally never cross the API boundary.
 */
export interface ChatMedia {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  altText?: string;
  source: ChatMediaSource;
}

export interface Message {
  id: string;
  sessionId: string;
  /** Thread this message belongs to; null is the implicit legacy main thread. */
  chatId?: string | null;
  role: MessageRole;
  content: string;
  createdAt: string;
  images?: MessageImage[];
  attachments?: MessageAttachment[];
  media?: ChatMedia[];
  /** Stable client id used to reconcile an optimistic/persisted delivery. */
  clientMessageId?: string;
  /** Monotone cursor for replayable events in this session. */
  eventSequence?: number;
}

export interface MessageHistorySnapshot {
  chatId: string | null;
  revision: number;
  highWatermark: number;
  newestMessageId: string | null;
}

export interface MessageJumpTarget {
  sessionId: string;
  chatId: string | null;
  messageId: string;
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface StreamingMessage {
  sessionId: string;
  /** Thread that owns the active provider turn. */
  chatId?: string | null;
  content: string;
  isComplete: boolean;
  toolUse?: ToolUse;
}
