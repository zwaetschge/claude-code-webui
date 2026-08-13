export type SessionSendDisposition = 'dispatched' | 'queued';

export interface SessionSendAttachmentResult {
  uploadId?: string;
  filename: string;
  status: 'accepted' | 'rejected';
  error?: string;
}

export type SessionSendAck =
  | {
      clientMessageId: string;
      /** Thread the server pinned this delivery to. */
      chatId?: string | null;
      status: 'accepted';
      acceptedAt: string;
      messageId?: string;
      disposition?: SessionSendDisposition;
      highWatermark?: number;
      attachments?: SessionSendAttachmentResult[];
    }
  | {
      clientMessageId: string;
      /** Requested thread when one was supplied by the client. */
      chatId?: string | null;
      status: 'rejected';
      error: string;
      retryable: boolean;
      attachments?: SessionSendAttachmentResult[];
    };

export type ChatUploadStatus = 'pending' | 'complete' | 'cancelled' | 'failed';

export interface ChatUpload {
  id: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  chunkSize: number;
  totalChunks: number;
  receivedBytes: number;
  receivedChunks: number[];
  missingChunks: number[];
  progress: number;
  status: ChatUploadStatus;
  error?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatUploadInput {
  filename: string;
  mimeType?: string;
  byteSize: number;
  sha256: string;
  chunkSize?: number;
}

export interface SessionReadState {
  sessionId: string;
  chatId: string | null;
  lastReadMessageId: string | null;
  unreadCount: number;
  updatedAt: string | null;
}

export interface SessionPresenceViewer {
  deviceId: string;
  label?: string;
  state: 'active' | 'idle';
  activeAt: string;
  lastReadMessageId?: string | null;
}

export interface SessionPresenceSnapshot {
  sessionId: string;
  viewers: SessionPresenceViewer[];
  total: number;
}
