import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  OrchestrationConfig,
} from '@claude-code-webui/shared';
import { config } from '../config';
import { ClaudeProcessManager } from '../services/claude/ClaudeProcessManager';
import { GeminiService } from '../services/gemini';
import { getLastRebuildResult } from '../services/self-rebuild';
import { orchestrationManager } from '../services/orchestration/index.js';
import { getRalph } from '../services/ralph';

// Module-level processManager reference for external access
let _processManager: ClaudeProcessManager | null = null;

export function getProcessManager(): ClaudeProcessManager {
  if (!_processManager) {
    throw new Error('ProcessManager not initialized. Call setupWebSocket first.');
  }
  return _processManager;
}

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: (origin, callback) => {
          // Allow same-origin requests (no origin header)
          if (!origin) {
            return callback(null, true);
          }
          // Check if origin is in the allowed list
          const normalizedOrigin = origin.toLowerCase();
          if (config.allowedOrigins.includes(normalizedOrigin)) {
            return callback(null, true);
          }
          // Reject unauthorized origins
          console.warn(`WebSocket CORS: Rejected connection from unauthorized origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      },
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for large images
    }
  );

  const processManager = new ClaudeProcessManager(io);
  _processManager = processManager;
  const geminiService = new GeminiService(io);

  // Initialize orchestration manager with IO
  orchestrationManager.setIO(io);

  // Check Gemini CLI availability on startup
  geminiService.checkAvailability().then((result) => {
    if (result.available) {
      console.log(`[GEMINI] Gemini CLI available: ${result.version}`);
    } else {
      console.warn(`[GEMINI] Gemini CLI not available: ${result.error}`);
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      socket.data.userId = decoded.userId;
      socket.data.subscribedSessions = new Set();
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} (user: ${socket.data.userId})`);

    // Debug: Log all incoming events
    socket.onAny((eventName, ...args) => {
      console.log(`[SOCKET EVENT] ${eventName}:`, args[0]?.sessionId || '', args[0]?.message?.substring(0, 30) || '');
    });

    // Subscribe to session output
    socket.on('session:subscribe', (sessionId) => {
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} subscribed to session ${sessionId}`);
    });

    // Unsubscribe from session output
    socket.on('session:unsubscribe', (sessionId) => {
      socket.data.subscribedSessions.delete(sessionId);
      socket.leave(`session:${sessionId}`);
      console.log(`Socket ${socket.id} unsubscribed from session ${sessionId}`);
    });

    // Send message to Claude
    socket.on('session:send', async ({ sessionId, message, images }) => {
      console.log(`Received session:send for ${sessionId}: "${message?.substring(0, 50)}..."`);
      try {
        await processManager.sendMessage(sessionId, socket.data.userId, message, images);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to send message',
        });
      }
    });

    // Interrupt Claude session
    socket.on('session:interrupt', (sessionId) => {
      try {
        processManager.interrupt(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to interrupt session',
        });
      }
    });

    // Set session permission mode
    socket.on('session:set-mode', ({ sessionId, mode }) => {
      console.log(`Setting session ${sessionId} mode to ${mode}`);
      try {
        processManager.setMode(sessionId, socket.data.userId, mode);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to set mode',
        });
      }
    });

    // Restart session (stop and start fresh)
    socket.on('session:restart', async (sessionId) => {
      console.log(`Restart request for session ${sessionId}`);
      try {
        await processManager.restartSession(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to restart session',
        });
      }
    });

    // Send raw input for interactive prompts (trust dialogs, etc.)
    socket.on('session:input', async ({ sessionId, input }) => {
      console.log(`Received session:input for ${sessionId}: "${input}"`);
      try {
        await processManager.sendRawInput(sessionId, socket.data.userId, input);
        console.log(`Input sent successfully to session ${sessionId}`);
      } catch (err) {
        console.error(`Failed to send input to session ${sessionId}:`, err);
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to send input',
        });
      }
    });

    // Generate image using Gemini CLI
    socket.on('session:generate-image', async ({ sessionId, prompt, model, referenceImages }) => {
      console.log(`Received session:generate-image for ${sessionId}: "${prompt}"`);
      try {
        const result = await geminiService.generateImage(sessionId, prompt, {
          model,
          referenceImages,
          userId: socket.data.userId,
        });

        if (result.success && result.imagePath) {
          socket.emit('session:image', {
            sessionId,
            imagePath: result.imagePath,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType || 'image/png',
            prompt,
            generator: 'gemini',
          });
        } else {
          socket.emit('session:error', {
            sessionId,
            error: result.error || 'Failed to generate image',
          });
        }
      } catch (err) {
        console.error(`Failed to generate image for session ${sessionId}:`, err);
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to generate image',
        });
      }
    });

    // Approve permission request
    socket.on('session:approve_permission', async ({ sessionId, toolNames, originalMessage }) => {
      console.log(`Received session:approve_permission for ${sessionId}: tools=${toolNames.join(', ')}`);
      try {
        await processManager.approvePermission(sessionId, socket.data.userId, toolNames, originalMessage);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to approve permission',
        });
      }
    });

    // Deny permission request
    socket.on('session:deny_permission', ({ sessionId }) => {
      console.log(`Received session:deny_permission for ${sessionId}`);
      try {
        processManager.denyPermission(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to deny permission',
        });
      }
    });

    // Reconnect to a running session
    socket.on('session:reconnect', async ({ sessionId, lastTimestamp }) => {
      console.log(`Reconnect request for session ${sessionId} from socket ${socket.id}`);

      // ALWAYS subscribe to the session room, regardless of running state
      // This ensures the socket receives events when a session starts
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} joined session room ${sessionId}`);

      // Check for recent rebuild and notify client
      try {
        const rebuildResult = await getLastRebuildResult();
        if (rebuildResult && rebuildResult.completedAt) {
          const completedTime = new Date(rebuildResult.completedAt).getTime();
          const now = Date.now();
          const fiveMinutesAgo = now - 5 * 60 * 1000;

          // If rebuild completed within last 5 minutes, notify client
          if (completedTime > fiveMinutesAgo) {
            console.log(`[REBUILD] Notifying client about recent rebuild completion`);
            socket.emit('self-rebuild:status', {
              status: 'idle',
              progress: rebuildResult.progress || 'Rebuild completed successfully',
              startedAt: rebuildResult.startedAt,
              completedAt: rebuildResult.completedAt,
            });
          }
        }
      } catch (err) {
        console.error('[REBUILD] Error checking rebuild status:', err);
      }

      const isRunning = processManager.isSessionRunning(sessionId);

      if (isRunning) {
        // Mark session as reconnected
        processManager.markSessionReconnected(sessionId);

        // Get buffered messages since last timestamp
        const bufferedMessages = processManager.getSessionBuffer(sessionId, lastTimestamp);

        console.log(`Session ${sessionId} reconnected with ${bufferedMessages.length} buffered messages`);

        // Send reconnection data
        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages,
          isRunning: true,
        });
      } else {
        // Session is not running, send empty reconnection data
        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages: [],
          isRunning: false,
        });
      }
    });

    // ========== Orchestration Events ==========

    // Configure orchestration
    socket.on('orchestration:configure' as keyof ClientToServerEvents, async (data: { sessionId: string; config: Partial<OrchestrationConfig> }) => {
      const { sessionId, config: orchestrationConfig } = data;
      console.log(`Received orchestration:configure for ${sessionId}`);
      try {
        const updatedConfig = orchestrationManager.updateConfig(sessionId, orchestrationConfig);
        if (!updatedConfig) {
          socket.emit('orchestration:error' as keyof ServerToClientEvents, {
            sessionId,
            error: 'No active orchestration for this session',
          } as never);
        }
      } catch (err) {
        socket.emit('orchestration:error' as keyof ServerToClientEvents, {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to configure orchestration',
        } as never);
      }
    });

    // Start orchestration
    socket.on('orchestration:start' as keyof ClientToServerEvents, async (data: { sessionId: string }) => {
      const { sessionId } = data;
      console.log(`Received orchestration:start for ${sessionId}`);
      try {
        await orchestrationManager.startOrchestration(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('orchestration:error' as keyof ServerToClientEvents, {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to start orchestration',
        } as never);
      }
    });

    // Stop orchestration
    socket.on('orchestration:stop' as keyof ClientToServerEvents, async (data: { sessionId: string }) => {
      const { sessionId } = data;
      console.log(`Received orchestration:stop for ${sessionId}`);
      try {
        await orchestrationManager.stopOrchestration(sessionId);
      } catch (err) {
        socket.emit('orchestration:error' as keyof ServerToClientEvents, {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to stop orchestration',
        } as never);
      }
    });

    // Interrupt a specific worker
    socket.on('orchestration:interrupt_worker' as keyof ClientToServerEvents, (data: { sessionId: string; workerId: string }) => {
      const { sessionId, workerId } = data;
      console.log(`Received orchestration:interrupt_worker for ${sessionId}, worker ${workerId}`);
      try {
        orchestrationManager.interruptWorker(sessionId, workerId);
      } catch (err) {
        socket.emit('orchestration:error' as keyof ServerToClientEvents, {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to interrupt worker',
          workerId,
        } as never);
      }
    });

    // Cancel a task
    socket.on('orchestration:cancel_task' as keyof ClientToServerEvents, (data: { sessionId: string; taskId: string }) => {
      const { sessionId, taskId } = data;
      console.log(`Received orchestration:cancel_task for ${sessionId}, task ${taskId}`);
      try {
        orchestrationManager.cancelTask(sessionId, taskId);
      } catch (err) {
        socket.emit('orchestration:error' as keyof ServerToClientEvents, {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to cancel task',
          taskId,
        } as never);
      }
    });

    // ========== Ralph Autonomous Loop Events ==========

    socket.on('ralph:start', async (data: { sessionId?: string; idea: string; config?: Record<string, unknown> }) => {
      console.log(`Received ralph:start: "${data.idea.substring(0, 50)}..."`);
      const ralph = getRalph();
      if (!ralph) {
        socket.emit('ralph:error', {
          sessionId: data.sessionId || '',
          runId: '',
          error: 'Ralph service not initialized',
        });
        return;
      }

      // Pre-join room if sessionId is known to avoid missing initial events
      if (data.sessionId) {
        socket.data.subscribedSessions.add(data.sessionId);
        socket.join(`session:${data.sessionId}`);
      }

      try {
        const run = await ralph.startRun(socket.data.userId, data.idea, {
          ...data.config,
          sessionId: data.sessionId,
        });

        // Join room for the actual session (may differ if new session was created)
        if (run.sessionId !== data.sessionId) {
          socket.data.subscribedSessions.add(run.sessionId);
          socket.join(`session:${run.sessionId}`);
        }

        // Emit initial state AFTER joining the room (avoids race condition)
        ralph.emitRunState(run.id);
      } catch (err) {
        socket.emit('ralph:error', {
          sessionId: data.sessionId || '',
          runId: '',
          error: err instanceof Error ? err.message : 'Failed to start Ralph run',
        });
      }
    });

    socket.on('ralph:pause', async (data: { runId: string }) => {
      console.log(`Received ralph:pause for run ${data.runId}`);
      const ralph = getRalph();
      if (!ralph) return;
      try {
        await ralph.pauseRun(data.runId);
      } catch (err) {
        console.error(`Failed to pause Ralph run ${data.runId}:`, err);
      }
    });

    socket.on('ralph:resume', async (data: { runId: string }) => {
      console.log(`Received ralph:resume for run ${data.runId}`);
      const ralph = getRalph();
      if (!ralph) return;
      try {
        await ralph.resumeRun(data.runId);
      } catch (err) {
        console.error(`Failed to resume Ralph run ${data.runId}:`, err);
      }
    });

    socket.on('ralph:stop', async (data: { runId: string }) => {
      console.log(`Received ralph:stop for run ${data.runId}`);
      const ralph = getRalph();
      if (!ralph) return;
      try {
        await ralph.stopRun(data.runId);
      } catch (err) {
        console.error(`Failed to stop Ralph run ${data.runId}:`, err);
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      // Mark subscribed sessions as disconnected
      for (const sessionId of socket.data.subscribedSessions) {
        processManager.markSessionDisconnected(sessionId);
      }
    });
  });

  return io;
}

export type { Server };
