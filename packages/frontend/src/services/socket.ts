import { io, Socket } from 'socket.io-client';
import type {
  ActiveFollowupMode,
  ClientToServerEvents,
  ServerToClientEvents,
  BufferedMessage,
  SessionMode,
  PermissionAction,
  PendingQuestion,
  PendingPermission,
  PermissionRequestData,
  ToolActionSummary,
  SessionSendAck,
  ChatUpload,
  ApiResponse,
} from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { toast } from '@/hooks/use-toast';
import { notificationService } from './notifications';
import { api, ApiError } from './api';
import {
  advanceMessageCursor,
  messageBelongsToChat,
  normalizeMessageChatId,
} from '@/lib/messageHistory';

// Simple ID generator
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SEND_ACK_TIMEOUT_MS = 30_000;

export type SendMessageAck =
  | SessionSendAck
  | {
      clientMessageId: string;
      status: 'queued-locally';
      acceptedAt: string;
      disposition: 'queued';
    };

export type FileUploadPhase =
  | 'hashing'
  | 'uploading'
  | 'retrying'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface FileUploadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  uploadedBytes: number;
  totalBytes: number;
  progress: number;
  phase: FileUploadPhase;
  attempt: number;
  error?: string;
}

export interface FileUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FileUploadProgress) => void;
}

interface PersistedOutboxEntry {
  version: 1;
  clientMessageId: string;
  sessionId: string;
  chatId?: string | null;
  message: string;
  activeFollowupMode?: ActiveFollowupMode;
  uploadIds?: string[];
  createdAt: string;
  attempts: number;
}

type OutboxStatusDetail = {
  clientMessageId: string;
  sessionId: string;
  status: 'queued' | 'sent' | 'failed';
  error?: string;
};

type SessionSendPayload = Parameters<ClientToServerEvents['session:send']>[0];

type ReliableSendEmitter = (
  event: 'session:send',
  data: SessionSendPayload,
  callback: (error: Error | null, acknowledgement?: SessionSendAck) => void
) => void;

const OUTBOX_STORAGE_KEY = 'plum.chat.outbox.v1';
const OUTBOX_MAX_ENTRIES = 50;
const OUTBOX_RETRY_NOTICE_AFTER = 3;
const CURSOR_STORAGE_PREFIX = 'plum.chat.cursor.v1:';

function emitOutboxStatus(detail: OutboxStatusDetail) {
  window.dispatchEvent(new CustomEvent<OutboxStatusDetail>('plum:outbox-status', { detail }));
}

function readOutbox(): PersistedOutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OUTBOX_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersistedOutboxEntry =>
        !!entry &&
        typeof entry === 'object' &&
        (entry as PersistedOutboxEntry).version === 1 &&
        typeof (entry as PersistedOutboxEntry).clientMessageId === 'string' &&
        typeof (entry as PersistedOutboxEntry).sessionId === 'string' &&
        typeof (entry as PersistedOutboxEntry).message === 'string'
    );
  } catch {
    return [];
  }
}

function writeOutbox(entries: PersistedOutboxEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      OUTBOX_STORAGE_KEY,
      JSON.stringify(entries.slice(-OUTBOX_MAX_ENTRIES))
    );
  } catch {
    // The caller still receives a normal send error when durable storage is unavailable.
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function throwIfUploadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Upload cancelled.');
  error.name = 'AbortError';
  throw error;
}

function isUploadAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function rejectedSend(clientMessageId: string, error: string, retryable = true): SendMessageAck {
  return { clientMessageId, status: 'rejected', error, retryable };
}

class SocketService {
  private socket: TypedSocket | null = null;
  private subscribedSessions: Set<string> = new Set();
  private activeSessions: Set<string> = new Set(); // Track sessions that are actively working
  private modeListeners: Set<(data: { sessionId: string; mode: SessionMode }) => void> = new Set();
  private lastSequenceBySession = new Map<string, number>();
  private activeChatBySession = new Map<string, string | null>();
  private fullResyncPendingSessions = new Set<string>();
  private flushOutboxPromise: Promise<void> | null = null;
  private presenceBySession = new Map<
    string,
    { state: 'active' | 'idle'; lastReadMessageId?: string | null }
  >();
  private deviceId: string | null = null;

  connect(): TypedSocket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    this.socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      // Resubscribe to sessions
      this.subscribedSessions.forEach((sessionId) => {
        this.socket?.emit('session:subscribe', sessionId);
      });
      this.presenceBySession.forEach((presence, sessionId) => {
        this.emitPresence(sessionId, presence.state, presence.lastReadMessageId);
      });
      void this.flushOutbox();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('session:output', (data) => {
      const activeChat = this.activeChatBySession.get(data.sessionId);
      if (
        activeChat !== undefined &&
        data.chatId !== undefined &&
        normalizeMessageChatId(data.chatId) !== activeChat
      ) {
        return;
      }
      useSessionStore.getState().appendStreamingContent(data.sessionId, data.content);
    });

    this.socket.on('session:message', (message) => {
      const { addMessageIfNotExists, clearStreamingContent, setActivity } =
        useSessionStore.getState();
      const activeChat = this.activeChatBySession.get(message.sessionId);
      if (activeChat !== undefined && !messageBelongsToChat(message, activeChat)) return;
      // Use addMessageIfNotExists to prevent duplicates when reconnecting
      addMessageIfNotExists(message.sessionId, message);
      if (typeof message.eventSequence === 'number') {
        this.updateLastSequence(message.sessionId, message.eventSequence);
      }
      clearStreamingContent(message.sessionId);
      // Tool executions stay in the timeline — they're part of the assistant
      // turn's history and we want them to remain visible alongside the
      // assistant's reply, not disappear when the message is saved.
      if (message.role === 'assistant') {
        setActivity(message.sessionId, { type: 'idle' });
      }
    });

    this.socket.on('session:status', (data) => {
      useSessionStore.getState().updateSessionStatus(data.sessionId, data.status);
    });

    this.socket.on('session:error', (data) => {
      console.error('Session error:', data.error);
      toast({
        title: 'Session action failed',
        description: data.error,
        variant: 'destructive',
      });
    });

    this.socket.on('session:thinking', (data) => {
      const { setThinking, setActivity, activity } = useSessionStore.getState();
      setThinking(data.sessionId, data.isThinking);
      // Update activity state
      if (data.isThinking) {
        this.activeSessions.add(data.sessionId);
        const existing = activity[data.sessionId];
        const now = Date.now();
        const message =
          data.message ?? (existing?.type === 'thinking' ? existing.message : undefined);
        const startedAt = existing?.type === 'thinking' ? (existing.startedAt ?? now) : now;
        const messageStartedAt =
          message && message !== existing?.message
            ? now
            : (existing?.messageStartedAt ?? (message ? now : undefined));
        setActivity(data.sessionId, { type: 'thinking', message, startedAt, messageStartedAt });
      } else {
        // Claude stopped thinking - check if task is complete
        const wasActive = this.activeSessions.has(data.sessionId);
        if (wasActive) {
          this.activeSessions.delete(data.sessionId);
          // Delay notification slightly to allow for permission requests or streaming
          setTimeout(() => {
            const { permissionRequests, pendingPermissions, streamingContent } =
              useSessionStore.getState();
            const hasPermissionRequest =
              !!permissionRequests[data.sessionId] || !!pendingPermissions[data.sessionId];
            const hasStreaming = !!streamingContent[data.sessionId];
            // Only notify if no pending permission request and no streaming
            if (
              !hasPermissionRequest &&
              !hasStreaming &&
              !this.activeSessions.has(data.sessionId)
            ) {
              notificationService.notifyTaskComplete(data.sessionId);
            }
          }, 500);
        }
        setActivity(data.sessionId, { type: 'idle' });
      }
    });

    this.socket.on('session:tool_use', (data) => {
      const store = useSessionStore.getState();

      // Mark session as active when tool starts
      if (data.status === 'started') {
        this.activeSessions.add(data.sessionId);
      }

      // Store tool execution for display. Prefer the backend-supplied
      // timestamp so this entry sorts correctly against assistant messages,
      // which carry backend clock timestamps via `createdAt`. Falling back
      // to Date.now() only matters for old backends without the field.
      const beTs = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
      if (data.status === 'started') {
        const toolId = data.toolId || generateId();
        const existing = (store.toolExecutions[data.sessionId] || []).some(
          (tool) => tool.toolId === toolId
        );
        if (existing) {
          store.updateToolExecution(data.sessionId, toolId, {
            input: data.input,
            ...(data.actionSummary ? { actionSummary: data.actionSummary } : {}),
          });
        } else {
          store.addToolExecution(data.sessionId, {
            toolId,
            toolName: data.toolName,
            status: 'started',
            input: data.input,
            actionSummary: data.actionSummary,
            timestamp: beTs,
          });
        }
      } else if (data.toolId) {
        store.updateToolExecution(data.sessionId, data.toolId, {
          status: data.status,
          completedAt: beTs,
          input: data.input,
          result: data.result,
          error: data.error,
          ...(data.actionSummary ? { actionSummary: data.actionSummary } : {}),
        });
      }

      // Update activity indicator
      store.setActivity(data.sessionId, {
        type: 'tool',
        toolName: data.toolName,
        toolStatus: data.status,
      });
    });

    this.socket.on('session:agent', (data) => {
      const { recordAgentEvent } = useSessionStore.getState();
      console.log(`[SOCKET] session:agent received:`, data.agentType, data.description);
      recordAgentEvent(data.sessionId, {
        agentId: data.agentId,
        agentType: data.agentType,
        description: data.description,
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        result: data.result,
        error: data.error,
        toolId: data.toolId,
        externalAgentId: data.externalAgentId,
        timestamp: data.timestamp,
      });
    });

    this.socket.on('session:todos', (data) => {
      console.log(`[SOCKET] Received ${data.todos.length} todos for session ${data.sessionId}`);
      useSessionStore.getState().setTodos(data.sessionId, data.todos);
    });

    this.socket.on('session:usage', (data) => {
      useSessionStore.getState().setUsage(data.sessionId, data);
    });

    this.socket.on('session:image', (data) => {
      console.log(`[SOCKET] session:image received:`, data.prompt?.substring(0, 50));
      useSessionStore.getState().addGeneratedImage(data.sessionId, {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType,
        prompt: data.prompt,
        generator: data.generator,
      });
    });

    this.socket.on('session:reconnected', (data) => {
      console.log(
        `[SOCKET] session:reconnected received: ${data.bufferedMessages.length} messages, isRunning=${data.isRunning}`
      );
      if (data.needsFullResync) {
        this.fullResyncPendingSessions.add(data.sessionId);
        window.dispatchEvent(
          new CustomEvent('plum:session-full-resync', {
            detail: {
              sessionId: data.sessionId,
              highWatermark: data.highWatermark,
              snapshotRevision: data.snapshotRevision,
            },
          })
        );
      } else {
        // Each replayed event advances the cursor only after its store update.
        // Never skip over unapplied events by trusting the aggregate watermark.
        this.replayBufferedMessages(data.sessionId, data.bufferedMessages);
      }

      // Update session status based on isRunning
      if (data.isRunning) {
        useSessionStore.getState().updateSessionStatus(data.sessionId, 'running');
      }
    });

    this.socket.on('session:cursor', (data) => {
      // The backend emits every sequenced live event before its cursor. Socket.IO
      // preserves packet order, so all synchronous store handlers have applied
      // the event by the time this cursor packet is handled.
      this.updateLastSequence(data.sessionId, data.sequence);
    });

    this.socket.on('session:compact', (data) => {
      console.log(`[SOCKET] session:compact received: ${data.message}`);
      const store = useSessionStore.getState();
      if (data.clear) {
        store.setMessages(data.sessionId, []);
        store.clearStreamingContent(data.sessionId);
        store.clearToolExecutions(data.sessionId);
      }
      if (data.reason === 'context-limit') {
        toast({
          title: 'Context limit reached',
          description: data.error || 'Auto-compacting context to continue.',
          variant: 'destructive',
        });
      }
      const summary = data.summary ? `\n\n${data.summary}` : '';
      const compactMessage = {
        id: data.id || `compact-${Date.now()}`,
        sessionId: data.sessionId,
        chatId: this.activeChatBySession.get(data.sessionId) ?? null,
        role: 'system' as const,
        content: `${data.message}${summary}`,
        createdAt: data.createdAt || new Date().toISOString(),
      };
      store.addMessageIfNotExists(data.sessionId, compactMessage);
    });

    this.socket.on('session:mode', (data) => {
      console.log(`[SOCKET] session:mode received:`, data.sessionId, data.mode);
      this.modeListeners.forEach((listener) => listener(data));
    });

    this.socket.on('session:queue', (data) => {
      useSessionStore.getState().setQueueState(data.sessionId, data);
    });

    this.socket.on('session:permission_request', (data) => {
      // Handle both legacy (denials) and new (hooks-based) permission request formats
      if ('denials' in data && data.denials) {
        // Legacy format with denials
        console.log(
          `[SOCKET] session:permission_request (legacy) received:`,
          data.denials.map((d) => d.tool_name).join(', ')
        );
        useSessionStore.getState().setPermissionRequest(data.sessionId, {
          denials: data.denials,
          originalMessage: data.originalMessage,
        });
        // Send notification for permission request
        const toolNames = data.denials.map((d) => d.tool_name);
        notificationService.notifyPermissionRequest(data.sessionId, toolNames);
      } else if ('requestId' in data) {
        // New hooks-based format
        console.log(
          `[SOCKET] session:permission_request (hooks) received:`,
          data.toolName,
          data.description
        );
        useSessionStore.getState().setPendingPermission(data.sessionId, data);
        // Send notification
        notificationService.notifyPermissionRequest(data.sessionId, [data.toolName]);
      }
    });

    this.socket.on('session:question_request', (data) => {
      console.log(`[SOCKET] session:question_request received:`, data.requestId);
      useSessionStore.getState().setPendingQuestion(data.sessionId, data);
      notificationService.notifyNeedsInput(data.sessionId, 'OpenCode needs your input');
    });

    this.socket.on('error', (message) => {
      console.error('Socket error:', message);
    });

    return this.socket;
  }

  private getLastSequence(sessionId: string): number | undefined {
    const inMemory = this.lastSequenceBySession.get(sessionId);
    if (typeof inMemory === 'number') return inMemory;
    try {
      const stored = Number(window.localStorage.getItem(`${CURSOR_STORAGE_PREFIX}${sessionId}`));
      if (Number.isFinite(stored) && stored > 0) {
        this.lastSequenceBySession.set(sessionId, stored);
        return stored;
      }
    } catch {
      // Continue without a cursor; the backend can return a full snapshot.
    }
    return undefined;
  }

  private updateLastSequence(sessionId: string, sequence: number): void {
    if (this.fullResyncPendingSessions.has(sessionId)) return;
    if (!Number.isFinite(sequence) || sequence <= 0) return;
    const current = this.lastSequenceBySession.get(sessionId) ?? this.getLastSequence(sessionId) ?? 0;
    const next = advanceMessageCursor(current, sequence);
    if (next <= current) return;
    this.lastSequenceBySession.set(sessionId, next);
    try {
      window.localStorage.setItem(`${CURSOR_STORAGE_PREFIX}${sessionId}`, String(next));
    } catch {
      // An in-memory cursor still prevents duplicate replay in this tab.
    }
  }

  /** Current replay cursor used to decide whether a REST snapshot is stale. */
  getSessionCursor(sessionId: string): number {
    return this.getLastSequence(sessionId) ?? 0;
  }

  /** Advance (never rewind) the reconnect cursor after a coherent REST snapshot. */
  recordSessionSnapshot(
    sessionId: string,
    highWatermark: number,
    chatId?: string | null,
    completesFullResync = false
  ): void {
    if (chatId !== undefined) {
      this.activeChatBySession.set(sessionId, normalizeMessageChatId(chatId) ?? null);
    }
    if (this.fullResyncPendingSessions.has(sessionId)) {
      if (!completesFullResync) return;
      // Only the explicit latest-window reconnect request may close the resync
      // transaction. An older/around page can have a coherent revision while
      // still omitting the gap that caused the full resync.
      this.fullResyncPendingSessions.delete(sessionId);
    }
    this.updateLastSequence(sessionId, highWatermark);
  }

  setSessionChat(sessionId: string, chatId: string | null): void {
    this.activeChatBySession.set(sessionId, normalizeMessageChatId(chatId) ?? null);
  }

  getSessionChat(sessionId: string): string | null | undefined {
    return this.activeChatBySession.get(sessionId);
  }

  private rememberOutboxEntry(entry: PersistedOutboxEntry): void {
    const entries = readOutbox();
    const existingIndex = entries.findIndex(
      (candidate) => candidate.clientMessageId === entry.clientMessageId
    );
    if (existingIndex >= 0) entries[existingIndex] = entry;
    else entries.push(entry);
    writeOutbox(entries);
  }

  private removeOutboxEntry(clientMessageId: string): void {
    writeOutbox(readOutbox().filter((entry) => entry.clientMessageId !== clientMessageId));
  }

  private emitReliableSend(payload: SessionSendPayload): Promise<SessionSendAck> {
    const socket = this.socket;
    const clientMessageId = payload.clientMessageId || createClientMessageId();
    if (!socket?.connected) {
      return Promise.resolve({
        clientMessageId,
        status: 'rejected',
        error: 'Connection unavailable. Reconnect and retry.',
        retryable: true,
      });
    }

    return new Promise((resolve) => {
      const timeoutSocket = socket.timeout(SEND_ACK_TIMEOUT_MS);
      const emitReliable = timeoutSocket.emit.bind(timeoutSocket) as ReliableSendEmitter;
      emitReliable('session:send', { ...payload, clientMessageId }, (error, acknowledgement) => {
        if (error) {
          resolve({
            clientMessageId,
            status: 'rejected',
            error: 'The server did not confirm this message. Retry is safe.',
            retryable: true,
          });
          return;
        }
        resolve(
          acknowledgement ?? {
            clientMessageId,
            status: 'rejected',
            error: 'The server returned an empty acknowledgement.',
            retryable: true,
          }
        );
      });
    });
  }

  private async flushOutbox(): Promise<void> {
    if (this.flushOutboxPromise) return this.flushOutboxPromise;
    this.flushOutboxPromise = (async () => {
      const entries = readOutbox().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const entry of entries) {
        if (!this.socket?.connected) break;
        const nextEntry = { ...entry, attempts: entry.attempts + 1 };
        this.rememberOutboxEntry(nextEntry);
        const acknowledgement = await this.emitReliableSend({
          sessionId: entry.sessionId,
          chatId: entry.chatId,
          message: entry.message,
          activeFollowupMode: entry.activeFollowupMode,
          clientMessageId: entry.clientMessageId,
          uploadIds: entry.uploadIds,
        });
        if (acknowledgement.status === 'accepted') {
          this.removeOutboxEntry(entry.clientMessageId);
          emitOutboxStatus({
            clientMessageId: entry.clientMessageId,
            sessionId: entry.sessionId,
            status: 'sent',
          });
          continue;
        }

        emitOutboxStatus({
          clientMessageId: entry.clientMessageId,
          sessionId: entry.sessionId,
          status: 'failed',
          error: acknowledgement.error,
        });
        if (!acknowledgement.retryable) {
          this.removeOutboxEntry(entry.clientMessageId);
          const sessionName =
            useSessionStore.getState().sessions.find((session) => session.id === entry.sessionId)
              ?.name ?? 'Unknown session';
          const preview = entry.message.trim().replace(/\s+/g, ' ').slice(0, 72);
          toast({
            title: 'Queued message was not sent',
            description: `${sessionName}${preview ? ` · “${preview}${entry.message.length > 72 ? '…' : ''}”` : ''}: ${acknowledgement.error}`,
            variant: 'destructive',
          });
          continue;
        }
        if (
          nextEntry.attempts === OUTBOX_RETRY_NOTICE_AFTER ||
          (nextEntry.attempts > OUTBOX_RETRY_NOTICE_AFTER && nextEntry.attempts % 5 === 0)
        ) {
          const sessionName =
            useSessionStore.getState().sessions.find((session) => session.id === entry.sessionId)
              ?.name ?? 'Unknown session';
          toast({
            title: 'Message is still waiting to send',
            description: `${sessionName}: ${acknowledgement.error} The draft remains safely in the outbox.`,
            variant: 'destructive',
          });
        }
        break;
      }
    })().finally(() => {
      this.flushOutboxPromise = null;
    });
    return this.flushOutboxPromise;
  }

  // Replay buffered messages from reconnection with deduplication
  private replayBufferedMessages(sessionId: string, messages: BufferedMessage[]): void {
    const store = useSessionStore.getState();
    const existingMessages = store.messages[sessionId] || [];
    const existingMessageIds = new Set(existingMessages.map((m) => m.id));

    const currentSequence = this.getLastSequence(sessionId) ?? 0;
    const orderedMessages = [...messages].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.timestamp - b.timestamp
    );
    for (const msg of orderedMessages) {
      if (typeof msg.sequence === 'number' && msg.sequence <= currentSequence) continue;
      switch (msg.type) {
        case 'output': {
          const data = msg.data as { content: string };
          store.appendStreamingContent(sessionId, data.content);
          break;
        }
        case 'message': {
          const data = msg.data as import('@plum-code-webui/shared').Message;
          const activeChat = this.activeChatBySession.get(sessionId);
          if (activeChat !== undefined && !messageBelongsToChat(data, activeChat)) continue;
          // Skip if message already exists (deduplication)
          if (existingMessageIds.has(data.id)) {
            console.log(`[SOCKET] Skipping duplicate message ${data.id}`);
            break;
          }
          store.addMessageIfNotExists(sessionId, data);
          existingMessageIds.add(data.id);
          store.clearStreamingContent(sessionId);
          // Tool executions stay in the timeline so the assistant turn's tool
          // history reappears after a reconnect, matching the live-flow path.
          if (data.role === 'assistant') {
            store.setActivity(sessionId, { type: 'idle' });
          }
          break;
        }
        case 'thinking': {
          const data = msg.data as { isThinking: boolean };
          store.setThinking(sessionId, data.isThinking);
          if (data.isThinking) {
            store.setActivity(sessionId, { type: 'thinking' });
          } else {
            store.setActivity(sessionId, { type: 'idle' });
          }
          break;
        }
        case 'tool_use': {
          const data = msg.data as {
            toolName: string;
            status: 'started' | 'completed' | 'error';
            toolId?: string;
            input?: unknown;
            result?: string;
            error?: string;
            actionSummary?: ToolActionSummary;
          };

          // Add tool execution to store (using original timestamp from buffered message)
          if (data.status === 'started') {
            const toolId = data.toolId || generateId();
            const existing = (store.toolExecutions[sessionId] || []).some(
              (tool) => tool.toolId === toolId
            );
            if (existing) {
              store.updateToolExecution(sessionId, toolId, {
                input: data.input,
                ...(data.actionSummary ? { actionSummary: data.actionSummary } : {}),
              });
            } else {
              store.addToolExecution(sessionId, {
                toolId,
                toolName: data.toolName,
                status: 'started',
                input: data.input,
                actionSummary: data.actionSummary,
                timestamp: msg.timestamp, // Use original timestamp
              });
            }
          } else if (data.toolId) {
            store.updateToolExecution(sessionId, data.toolId, {
              status: data.status,
              result: data.result,
              error: data.error,
              ...(data.actionSummary ? { actionSummary: data.actionSummary } : {}),
              completedAt: msg.timestamp,
            });
          }

          // Update activity indicator
          store.setActivity(sessionId, {
            type: 'tool',
            toolName: data.toolName,
            toolStatus: data.status,
          });
          break;
        }
        case 'todos': {
          const data = msg.data as {
            todos: Array<{
              content: string;
              status: 'pending' | 'in_progress' | 'completed';
              activeForm?: string;
            }>;
          };
          store.setTodos(sessionId, data.todos);
          break;
        }
        case 'usage': {
          const data = msg.data as Parameters<typeof store.setUsage>[1];
          store.setUsage(sessionId, data);
          break;
        }
        case 'agent': {
          const data = msg.data as {
            agentId?: string;
            agentType: string;
            description?: string;
            status: 'started' | 'completed' | 'error';
            startedAt?: number;
            completedAt?: number;
            result?: string;
            error?: string;
            toolId?: string;
            externalAgentId?: string;
            timestamp?: number;
          };
          store.recordAgentEvent(sessionId, {
            agentId: data.agentId,
            agentType: data.agentType,
            description: data.description,
            status: data.status,
            startedAt: data.startedAt,
            completedAt: data.completedAt,
            result: data.result,
            error: data.error,
            toolId: data.toolId,
            externalAgentId: data.externalAgentId,
            timestamp: data.timestamp ?? msg.timestamp,
          });
          break;
        }
        case 'status': {
          const data = msg.data as { status: 'running' | 'stopped' | 'error' };
          store.updateSessionStatus(sessionId, data.status);
          break;
        }
        case 'mode': {
          const data = msg.data as { sessionId: string; mode: SessionMode };
          this.modeListeners.forEach((listener) => listener(data));
          break;
        }
        case 'compact': {
          const data = msg.data as {
            id?: string;
            sessionId: string;
            message: string;
            summary?: string;
            clear?: boolean;
            reason?: 'auto-compact' | 'provider-switch' | 'context-limit';
            error?: string;
            createdAt?: string;
          };
          if (data.clear) {
            store.setMessages(sessionId, []);
            store.clearStreamingContent(sessionId);
            store.clearToolExecutions(sessionId);
          }
          const compactMessage = {
            id: data.id || `compact-${msg.timestamp}`,
            sessionId,
            chatId: this.activeChatBySession.get(sessionId) ?? null,
            role: 'system' as const,
            content: `${data.message}${data.summary ? `\n\n${data.summary}` : ''}`,
            createdAt: data.createdAt || new Date(msg.timestamp).toISOString(),
          };
          store.addMessageIfNotExists(sessionId, compactMessage);
          break;
        }
        case 'question': {
          const data = msg.data as PendingQuestion;
          store.setPendingQuestion(sessionId, data);
          break;
        }
        case 'permission_request': {
          const data = msg.data as PermissionRequestData | PendingPermission;
          if ('denials' in data && data.denials) {
            store.setPermissionRequest(sessionId, {
              denials: data.denials,
              originalMessage: data.originalMessage,
            });
          } else if ('requestId' in data) {
            store.setPendingPermission(sessionId, data);
          }
          break;
        }
      }
      if (typeof msg.sequence === 'number') this.updateLastSequence(sessionId, msg.sequence);
    }

    // Update last message timestamp after replay
    if (orderedMessages.length > 0) {
      const lastTimestamp = orderedMessages[orderedMessages.length - 1]?.timestamp || Date.now();
      store.updateLastMessageTimestamp(sessionId, lastTimestamp);
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.subscribedSessions.clear();
  }

  onModeChange(listener: (data: { sessionId: string; mode: SessionMode }) => void): () => void {
    this.modeListeners.add(listener);
    return () => {
      this.modeListeners.delete(listener);
    };
  }

  subscribeToSession(sessionId: string): void {
    this.subscribedSessions.add(sessionId);
    this.socket?.emit('session:subscribe', sessionId);
    this.setSessionPresence(sessionId, 'active');
  }

  unsubscribeFromSession(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    this.socket?.emit('session:unsubscribe', sessionId);
    this.emitPresence(sessionId, 'leave');
    this.presenceBySession.delete(sessionId);
  }

  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    const storageKey = 'plum.web-device-id.v1';
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        this.deviceId = stored;
        return stored;
      }
      const created = createClientMessageId();
      window.localStorage.setItem(storageKey, created);
      this.deviceId = created;
      return created;
    } catch {
      this.deviceId = createClientMessageId();
      return this.deviceId;
    }
  }

  private emitPresence(
    sessionId: string,
    state: 'active' | 'idle' | 'leave',
    lastReadMessageId?: string | null
  ): void {
    this.socket?.emit('session:presence', {
      sessionId,
      deviceId: this.getDeviceId(),
      label: 'Web',
      state,
      lastReadMessageId,
    });
  }

  setSessionPresence(
    sessionId: string,
    state: 'active' | 'idle',
    lastReadMessageId?: string | null
  ): void {
    this.presenceBySession.set(sessionId, { state, lastReadMessageId });
    this.emitPresence(sessionId, state, lastReadMessageId);
  }

  sendMessage(
    sessionId: string,
    message: string,
    images?: { data: string; mimeType: string; filename?: string }[],
    activeFollowupMode?: ActiveFollowupMode,
    clientMessageId = createClientMessageId(),
    uploadIds?: string[]
  ): Promise<SendMessageAck> {
    console.log(
      `sendMessage: sessionId=${sessionId}, message="${message}", socket=${!!this.socket}, connected=${this.socket?.connected}`
    );
    const payload: SessionSendPayload = {
      sessionId,
      chatId: this.activeChatBySession.get(sessionId),
      message,
      images,
      activeFollowupMode,
      clientMessageId,
      uploadIds,
    };
    const canPersist = !images || images.length === 0;
    if (canPersist) {
      this.rememberOutboxEntry({
        version: 1,
        clientMessageId,
        sessionId,
        chatId: this.activeChatBySession.get(sessionId),
        message,
        activeFollowupMode,
        uploadIds,
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
    }

    if (!this.socket?.connected) {
      if (canPersist) {
        emitOutboxStatus({ clientMessageId, sessionId, status: 'queued' });
        return Promise.resolve({
          clientMessageId,
          status: 'queued-locally',
          acceptedAt: new Date().toISOString(),
          disposition: 'queued',
        });
      }
      return Promise.resolve(
        rejectedSend(clientMessageId, 'Connection unavailable. Reconnect and retry.')
      );
    }

    return this.emitReliableSend(payload).then((acknowledgement) => {
      if (acknowledgement.status === 'accepted') {
        if (canPersist) this.removeOutboxEntry(clientMessageId);
        emitOutboxStatus({ clientMessageId, sessionId, status: 'sent' });
      } else {
        if (canPersist && !acknowledgement.retryable) this.removeOutboxEntry(clientMessageId);
        emitOutboxStatus({
          clientMessageId,
          sessionId,
          status: 'failed',
          error: acknowledgement.error,
        });
      }
      return acknowledgement;
    });
  }

  // Send raw input for interactive prompts (trust dialogs, selections, etc.)
  sendInput(sessionId: string, input: string): void {
    console.log(`Sending input to session ${sessionId}: "${input}"`);
    this.socket?.emit('session:input', { sessionId, input });
  }

  async sendMessageWithFiles(
    sessionId: string,
    message: string,
    files: File[],
    activeFollowupMode?: ActiveFollowupMode,
    clientMessageId = createClientMessageId(),
    uploadOptions: FileUploadOptions = {}
  ): Promise<SendMessageAck> {
    const createdUploadIds: string[] = [];
    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        if (!file) continue;
        const uploadId = await this.stageFileUpload(sessionId, file, {
          ...uploadOptions,
          fileIndex,
          totalFiles: files.length,
        });
        createdUploadIds.push(uploadId);
      }
      const acknowledgement = await this.sendMessage(
        sessionId,
        message,
        undefined,
        activeFollowupMode,
        clientMessageId,
        createdUploadIds
      );
      if (acknowledgement.status === 'rejected' && !acknowledgement.retryable) {
        await Promise.allSettled(
          createdUploadIds.map((uploadId) =>
            api.delete(`/api/sessions/${sessionId}/uploads/${uploadId}`)
          )
        );
      }
      return acknowledgement;
    } catch (error) {
      await Promise.allSettled(
        createdUploadIds.map((uploadId) =>
          api.delete(`/api/sessions/${sessionId}/uploads/${uploadId}`)
        )
      );
      if (isUploadAbort(error, uploadOptions.signal)) {
        return rejectedSend(clientMessageId, 'Upload cancelled.');
      }
      if (error instanceof ApiError && [404, 405, 501].includes(error.status)) {
        // Legacy servers have no staging API. Keep the old base64 route as a
        // compatibility path without retaining encoded copies in the outbox.
        try {
          const attachments = await Promise.all(
            files.map(async (file) => ({
              data: await this.fileToBase64(file),
              mimeType: file.type || 'application/octet-stream',
              filename: file.name,
            }))
          );
          return await this.sendMessage(
            sessionId,
            message,
            attachments,
            activeFollowupMode,
            clientMessageId
          );
        } catch (legacyError) {
          return rejectedSend(
            clientMessageId,
            legacyError instanceof Error
              ? legacyError.message
              : 'Could not read the selected files.'
          );
        }
      }
      return rejectedSend(
        clientMessageId,
        error instanceof Error ? error.message : 'Could not upload the selected files.'
      );
    }
  }

  private async stageFileUpload(
    sessionId: string,
    file: File,
    options: FileUploadOptions & { fileIndex: number; totalFiles: number }
  ): Promise<string> {
    const { signal, onProgress, fileIndex, totalFiles } = options;
    const report = (
      phase: FileUploadPhase,
      progress: number,
      uploadedBytes: number,
      attempt: number,
      error?: string
    ) =>
      onProgress?.({
        fileName: file.name,
        fileIndex,
        totalFiles,
        uploadedBytes,
        totalBytes: file.size,
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        phase,
        attempt,
        error,
      });

    let uploadId: string | null = null;
    try {
      throwIfUploadAborted(signal);
      report('hashing', 0, 0, 1);
      const wholeHash = await sha256(file);
      throwIfUploadAborted(signal);
      const created = await api.post<ApiResponse<ChatUpload>>(
        `/api/sessions/${sessionId}/uploads`,
        {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          byteSize: file.size,
          sha256: wholeHash,
        },
        { signal }
      );
      const upload = created.data.data;
      if (!created.data.success || !upload) {
        throw new Error(`Could not start upload for ${file.name}.`);
      }
      uploadId = upload.id;

      const chunkSize = Math.max(1, upload.chunkSize);
      const allChunkIndexes = Array.from({ length: upload.totalChunks }, (_, index) => index);
      const bytesForChunks = (indexes: Iterable<number>) => {
        let bytes = 0;
        for (const index of indexes) {
          const start = index * chunkSize;
          bytes += Math.max(0, Math.min(file.size, start + chunkSize) - start);
        }
        return Math.min(file.size, bytes);
      };
      let received = new Set(upload.receivedChunks ?? []);
      let lastError: unknown;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        throwIfUploadAborted(signal);
        try {
          let currentUpload = upload;
          if (attempt > 1) {
            const resumed = await api.get<ApiResponse<ChatUpload>>(
              `/api/sessions/${sessionId}/uploads/${upload.id}`,
              { signal }
            );
            if (!resumed.data.success || !resumed.data.data) {
              throw new Error(`Could not resume ${file.name}.`);
            }
            currentUpload = resumed.data.data;
            received = new Set(currentUpload.receivedChunks ?? []);
            if (currentUpload.status === 'complete') {
              report('complete', 100, file.size, attempt);
              return upload.id;
            }
            report(
              'retrying',
              currentUpload.progress * 100,
              currentUpload.receivedBytes,
              attempt,
              lastError instanceof Error ? lastError.message : undefined
            );
          }

          const missing =
            currentUpload.missingChunks?.length > 0
              ? currentUpload.missingChunks
              : allChunkIndexes.filter((index) => !received.has(index));

          for (const index of missing) {
            throwIfUploadAborted(signal);
            const start = index * chunkSize;
            const endExclusive = Math.min(file.size, start + chunkSize);
            const chunk = file.slice(start, endExclusive);
            const chunkHash = await sha256(chunk);
            throwIfUploadAborted(signal);
            await api.request<ApiResponse<ChatUpload>>(
              `/api/sessions/${sessionId}/uploads/${upload.id}/chunks/${index}`,
              {
                method: 'PUT',
                body: chunk,
                signal,
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Range': `bytes ${start}-${endExclusive - 1}/${file.size}`,
                  'X-Chunk-SHA256': chunkHash,
                },
              }
            );
            received.add(index);
            const uploadedBytes = bytesForChunks(received);
            report(
              'uploading',
              file.size === 0 ? 100 : (uploadedBytes / file.size) * 100,
              uploadedBytes,
              attempt
            );
          }

          const verified = await api.get<ApiResponse<ChatUpload>>(
            `/api/sessions/${sessionId}/uploads/${upload.id}`,
            { signal }
          );
          if (verified.data.success && verified.data.data?.status === 'complete') {
            report('complete', 100, file.size, attempt);
            return upload.id;
          }
          lastError = new Error(`${file.name} still has missing chunks.`);
        } catch (error) {
          if (isUploadAbort(error, signal)) throw error;
          lastError = error;
        }
      }

      throw (lastError instanceof Error
        ? lastError
        : new Error(`${file.name} did not finish uploading.`));
    } catch (error) {
      const cancelled = isUploadAbort(error, signal);
      report(
        cancelled ? 'cancelled' : 'error',
        0,
        0,
        3,
        cancelled ? 'Upload cancelled.' : error instanceof Error ? error.message : undefined
      );
      if (uploadId) {
        await api.delete(`/api/sessions/${sessionId}/uploads/${uploadId}`).catch(() => undefined);
      }
      throw error;
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  interruptSession(sessionId: string): void {
    this.socket?.emit('session:interrupt', sessionId);
  }

  // Restart session (stop and start fresh)
  restartSession(sessionId: string): void {
    console.log(`[SOCKET] Restarting session ${sessionId}`);
    this.socket?.emit('session:restart', sessionId);
  }

  // Set session permission mode
  setSessionMode(sessionId: string, mode: SessionMode): void {
    console.log(`[SOCKET] Setting session ${sessionId} mode to ${mode}`);
    this.socket?.emit('session:set-mode', { sessionId, mode });
  }

  // Request to reconnect to a running session and get buffered messages
  reconnectToSession(sessionId: string, lastTimestamp?: number): void {
    const lastSequence = this.getLastSequence(sessionId);
    console.log(
      `[SOCKET] Reconnecting to session ${sessionId}, lastTimestamp=${lastTimestamp}, lastSequence=${lastSequence}`
    );
    this.subscribedSessions.add(sessionId);
    this.setSessionPresence(sessionId, document.visibilityState === 'visible' ? 'active' : 'idle');
    this.socket?.emit('session:reconnect', { sessionId, lastTimestamp, lastSequence });
  }

  // Approve permission request - allow specific tools (legacy flow)
  approvePermission(sessionId: string, toolNames: string[], originalMessage: string): void {
    console.log(`[SOCKET] Approving permission for tools: ${toolNames.join(', ')}`);
    useSessionStore.getState().clearPermissionRequest(sessionId);
    this.socket?.emit('session:approve_permission', { sessionId, toolNames, originalMessage });
  }

  // Deny permission request (legacy flow)
  denyPermission(sessionId: string): void {
    console.log(`[SOCKET] Denying permission for session ${sessionId}`);
    useSessionStore.getState().clearPermissionRequest(sessionId);
    this.socket?.emit('session:deny_permission', { sessionId });
  }

  // Respond to a permission request (hooks-based flow)
  async respondToPermission(
    sessionId: string,
    requestId: string,
    action: PermissionAction,
    pattern?: string
  ): Promise<void> {
    console.log(`[SOCKET] Responding to permission ${requestId}: ${action}`);

    // Call the backend API to respond (the long-polling endpoint will pick this up)
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch('/api/permissions/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sessionId,
        requestId,
        action,
        pattern,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to respond to permission request');
    }

    // Clear the pending permission from the store
    useSessionStore.getState().setPendingPermission(sessionId, null);
  }

  async respondToQuestion(
    sessionId: string,
    requestId: string,
    answers: string[][],
    providerSessionId?: string
  ): Promise<void> {
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch('/api/opencode/questions/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, answers, providerSessionId }),
    });

    if (!response.ok) {
      throw new Error('Failed to respond to OpenCode question');
    }

    useSessionStore.getState().setPendingQuestion(sessionId, null);
  }

  async rejectQuestion(
    sessionId: string,
    requestId: string,
    providerSessionId?: string
  ): Promise<void> {
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch('/api/opencode/questions/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, providerSessionId }),
    });

    if (!response.ok) {
      throw new Error('Failed to reject OpenCode question');
    }

    useSessionStore.getState().setPendingQuestion(sessionId, null);
  }

  // Generic emit for typed events
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void {
    this.socket?.emit(event, ...args);
  }

  getSocket(): TypedSocket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
