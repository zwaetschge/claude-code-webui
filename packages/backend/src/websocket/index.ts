import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';
import { config } from '../config';
import { ClaudeProcessManager } from '../services/claude/ClaudeProcessManager';
import { GeminiService } from '../services/gemini';

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: (origin, callback) => {
          // Allow same-origin requests (no origin header) or matching frontend URL (case-insensitive)
          if (!origin || origin.toLowerCase() === config.frontendUrl.toLowerCase()) {
            callback(null, true);
          } else {
            callback(null, true); // Allow all origins in production for Docker
          }
        },
        credentials: true,
      },
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for large images
    }
  );

  const processManager = new ClaudeProcessManager(io);
  const geminiService = new GeminiService(io);

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

    // Reconnect to a running session
    socket.on('session:reconnect', ({ sessionId, lastTimestamp }) => {
      console.log(`Reconnect request for session ${sessionId} from socket ${socket.id}`);

      // ALWAYS subscribe to the session room, regardless of running state
      // This ensures the socket receives events when a session starts
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} joined session room ${sessionId}`);

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
