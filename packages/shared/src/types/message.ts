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

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  images?: MessageImage[];
  attachments?: MessageAttachment[];
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface StreamingMessage {
  sessionId: string;
  content: string;
  isComplete: boolean;
  toolUse?: ToolUse;
}
