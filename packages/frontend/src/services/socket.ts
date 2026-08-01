import { io, Socket } from 'socket.io-client';
import type {
  ActiveFollowupMode,
  ClientToServerEvents,
  ServerToClientEvents,
  BufferedMessage,
  SessionMode,
  PermissionAction,
  PendingQuestion,
  ToolActionSummary,
} from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { toast } from '@/hooks/use-toast';
import { notificationService } from './notifications';

// Simple ID generator
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

class SocketService {
  private socket: TypedSocket | null = null;
  private subscribedSessions: Set<string> = new Set();
  private activeSessions: Set<string> = new Set(); // Track sessions that are actively working
  private modeListeners: Set<(data: { sessionId: string; mode: SessionMode }) => void> = new Set();

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
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('session:output', (data) => {
      useSessionStore.getState().appendStreamingContent(data.sessionId, data.content);
    });

    this.socket.on('session:message', (message) => {
      const { addMessageIfNotExists, clearStreamingContent, setActivity } =
        useSessionStore.getState();
      // Use addMessageIfNotExists to prevent duplicates when reconnecting
      addMessageIfNotExists(message.sessionId, message);
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
      this.replayBufferedMessages(data.sessionId, data.bufferedMessages);

      // Update session status based on isRunning
      if (data.isRunning) {
        useSessionStore.getState().updateSessionStatus(data.sessionId, 'running');
      }
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

  // Replay buffered messages from reconnection with deduplication
  private replayBufferedMessages(sessionId: string, messages: BufferedMessage[]): void {
    const store = useSessionStore.getState();
    const existingMessages = store.messages[sessionId] || [];
    const existingMessageIds = new Set(existingMessages.map((m) => m.id));

    for (const msg of messages) {
      switch (msg.type) {
        case 'output': {
          const data = msg.data as { content: string };
          store.appendStreamingContent(sessionId, data.content);
          break;
        }
        case 'message': {
          const data = msg.data as {
            id: string;
            sessionId: string;
            role: 'user' | 'assistant' | 'system';
            content: string;
            createdAt: string;
            images?: { path: string; filename: string }[];
          };
          // Skip if message already exists (deduplication)
          if (existingMessageIds.has(data.id)) {
            console.log(`[SOCKET] Skipping duplicate message ${data.id}`);
            continue;
          }
          store.addMessageIfNotExists(sessionId, data);
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
      }
    }

    // Update last message timestamp after replay
    if (messages.length > 0) {
      const lastTimestamp = messages[messages.length - 1]?.timestamp || Date.now();
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
  }

  unsubscribeFromSession(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    this.socket?.emit('session:unsubscribe', sessionId);
  }

  sendMessage(
    sessionId: string,
    message: string,
    images?: { data: string; mimeType: string; filename?: string }[],
    activeFollowupMode?: ActiveFollowupMode
  ): void {
    // clientMessageId lets the server dedupe if the socket reconnects and we retry:
    // a single logical send keeps the same id regardless of transport hiccups.
    const clientMessageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    console.log(
      `sendMessage: sessionId=${sessionId}, message="${message}", socket=${!!this.socket}, connected=${this.socket?.connected}`
    );
    this.socket?.emit('session:send', {
      sessionId,
      message,
      images,
      activeFollowupMode,
      clientMessageId,
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
    activeFollowupMode?: ActiveFollowupMode
  ): Promise<void> {
    // Convert files to base64
    const attachments = await Promise.all(
      files.map(async (file) => {
        const base64 = await this.fileToBase64(file);
        return {
          data: base64,
          mimeType: file.type || 'application/octet-stream',
          filename: file.name,
        };
      })
    );

    this.sendMessage(
      sessionId,
      message,
      attachments.length > 0 ? attachments : undefined,
      activeFollowupMode
    );
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
    console.log(`[SOCKET] Reconnecting to session ${sessionId}, lastTimestamp=${lastTimestamp}`);
    this.subscribedSessions.add(sessionId);
    this.socket?.emit('session:reconnect', { sessionId, lastTimestamp });
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
