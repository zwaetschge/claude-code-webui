import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  BufferedMessage,
  SessionMode,
  PermissionAction,
} from '@claude-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
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
      console.log(`[SOCKET] session:output received:`, data.content?.substring(0, 50));
      useSessionStore.getState().appendStreamingContent(data.sessionId, data.content);
    });

    this.socket.on('session:message', (message) => {
      const { addMessage, clearStreamingContent, clearToolExecutions, setActivity } = useSessionStore.getState();
      addMessage(message.sessionId, message);
      clearStreamingContent(message.sessionId);
      // Clear tool executions when a new message is saved (Claude finished responding)
      if (message.role === 'assistant') {
        clearToolExecutions(message.sessionId);
        setActivity(message.sessionId, { type: 'idle' });
      }
    });

    this.socket.on('session:status', (data) => {
      useSessionStore.getState().updateSessionStatus(data.sessionId, data.status);
    });

    this.socket.on('session:error', (data) => {
      console.error('Session error:', data.error);
    });

    this.socket.on('session:thinking', (data) => {
      const { setThinking, setActivity } = useSessionStore.getState();
      setThinking(data.sessionId, data.isThinking);
      // Update activity state
      if (data.isThinking) {
        this.activeSessions.add(data.sessionId);
        setActivity(data.sessionId, { type: 'thinking' });
      } else {
        // Claude stopped thinking - check if task is complete
        const wasActive = this.activeSessions.has(data.sessionId);
        if (wasActive) {
          this.activeSessions.delete(data.sessionId);
          // Delay notification slightly to allow for permission requests or streaming
          setTimeout(() => {
            const { permissionRequests, pendingPermissions, streamingContent } = useSessionStore.getState();
            const hasPermissionRequest = !!permissionRequests[data.sessionId] || !!pendingPermissions[data.sessionId];
            const hasStreaming = !!streamingContent[data.sessionId];
            // Only notify if no pending permission request and no streaming
            if (!hasPermissionRequest && !hasStreaming && !this.activeSessions.has(data.sessionId)) {
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

      // Store tool execution for display
      if (data.status === 'started') {
        store.addToolExecution(data.sessionId, {
          toolId: data.toolId || generateId(),
          toolName: data.toolName,
          status: 'started',
          input: data.input,
          timestamp: Date.now(),
        });
      } else if (data.toolId) {
        store.updateToolExecution(data.sessionId, data.toolId, {
          status: data.status,
          input: data.input,
          result: data.result,
          error: data.error,
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
      const { setActiveAgent } = useSessionStore.getState();
      console.log(`[SOCKET] session:agent received:`, data.agentType, data.description);
      if (data.status === 'started') {
        setActiveAgent(data.sessionId, {
          agentType: data.agentType,
          description: data.description,
          status: data.status,
        });
      } else {
        // Clear agent when completed or error
        setActiveAgent(data.sessionId, null);
      }
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
      console.log(`[SOCKET] session:reconnected received: ${data.bufferedMessages.length} messages, isRunning=${data.isRunning}`);
      this.replayBufferedMessages(data.sessionId, data.bufferedMessages);

      // Update session status based on isRunning
      if (data.isRunning) {
        useSessionStore.getState().updateSessionStatus(data.sessionId, 'running');
      }
    });

    this.socket.on('session:compact', (data) => {
      console.log(`[SOCKET] session:compact received: ${data.message}`);
      // Notify the user about context compaction by adding a system message
      const compactMessage = {
        id: `compact-${Date.now()}`,
        sessionId: data.sessionId,
        role: 'system' as const,
        content: '🗜️ Context was auto-compacted to reduce token usage. Previous context has been summarized.',
        createdAt: new Date().toISOString(),
      };
      useSessionStore.getState().addMessage(data.sessionId, compactMessage);
    });

    this.socket.on('session:permission_request', (data) => {
      // Handle both legacy (denials) and new (hooks-based) permission request formats
      if ('denials' in data && data.denials) {
        // Legacy format with denials
        console.log(`[SOCKET] session:permission_request (legacy) received:`, data.denials.map(d => d.tool_name).join(', '));
        useSessionStore.getState().setPermissionRequest(data.sessionId, {
          denials: data.denials,
          originalMessage: data.originalMessage,
        });
        // Send notification for permission request
        const toolNames = data.denials.map(d => d.tool_name);
        notificationService.notifyPermissionRequest(data.sessionId, toolNames);
      } else if ('requestId' in data) {
        // New hooks-based format
        console.log(`[SOCKET] session:permission_request (hooks) received:`, data.toolName, data.description);
        useSessionStore.getState().setPendingPermission(data.sessionId, data);
        // Send notification
        notificationService.notifyPermissionRequest(data.sessionId, [data.toolName]);
      }
    });

    this.socket.on('error', (message) => {
      console.error('Socket error:', message);
    });

    return this.socket;
  }

  // Replay buffered messages from reconnection
  private replayBufferedMessages(sessionId: string, messages: BufferedMessage[]): void {
    const store = useSessionStore.getState();

    for (const msg of messages) {
      switch (msg.type) {
        case 'output': {
          const data = msg.data as { content: string };
          store.appendStreamingContent(sessionId, data.content);
          break;
        }
        case 'message': {
          const data = msg.data as { id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; images?: { path: string; filename: string }[] };
          store.addMessage(sessionId, data);
          store.clearStreamingContent(sessionId);
          // Clear tool executions when assistant message is received
          if (data.role === 'assistant') {
            store.clearToolExecutions(sessionId);
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
          const data = msg.data as { toolName: string; status: 'started' | 'completed' | 'error'; toolId?: string; input?: unknown; result?: string; error?: string };

          // Add tool execution to store (using original timestamp from buffered message)
          if (data.status === 'started') {
            store.addToolExecution(sessionId, {
              toolId: data.toolId || generateId(),
              toolName: data.toolName,
              status: 'started',
              input: data.input,
              timestamp: msg.timestamp, // Use original timestamp
            });
          } else if (data.toolId) {
            store.updateToolExecution(sessionId, data.toolId, {
              status: data.status,
              result: data.result,
              error: data.error,
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
          const data = msg.data as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }> };
          store.setTodos(sessionId, data.todos);
          break;
        }
        case 'usage': {
          const data = msg.data as Parameters<typeof store.setUsage>[1];
          store.setUsage(sessionId, data);
          break;
        }
        case 'agent': {
          const data = msg.data as { agentType: string; description?: string; status: 'started' | 'completed' | 'error' };
          if (data.status === 'started') {
            store.setActiveAgent(sessionId, {
              agentType: data.agentType,
              description: data.description,
              status: data.status,
            });
          } else {
            store.setActiveAgent(sessionId, null);
          }
          break;
        }
        case 'status': {
          const data = msg.data as { status: 'running' | 'stopped' | 'error' };
          store.updateSessionStatus(sessionId, data.status);
          break;
        }
      }
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.subscribedSessions.clear();
  }

  subscribeToSession(sessionId: string): void {
    this.subscribedSessions.add(sessionId);
    this.socket?.emit('session:subscribe', sessionId);
  }

  unsubscribeFromSession(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    this.socket?.emit('session:unsubscribe', sessionId);
  }

  sendMessage(sessionId: string, message: string, images?: { data: string; mimeType: string }[]): void {
    console.log(`sendMessage: sessionId=${sessionId}, message="${message}", socket=${!!this.socket}, connected=${this.socket?.connected}`);
    this.socket?.emit('session:send', { sessionId, message, images });
  }

  // Send raw input for interactive prompts (trust dialogs, selections, etc.)
  sendInput(sessionId: string, input: string): void {
    console.log(`Sending input to session ${sessionId}: "${input}"`);
    this.socket?.emit('session:input', { sessionId, input });
  }

  async sendMessageWithFiles(
    sessionId: string,
    message: string,
    files: File[]
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

    this.sendMessage(sessionId, message, attachments.length > 0 ? attachments : undefined);
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

  getSocket(): TypedSocket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
