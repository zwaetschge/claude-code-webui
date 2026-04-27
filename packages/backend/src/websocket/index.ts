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
import { getDatabase } from '../db';
import { ClaudeProcessManager } from '../services/claude/ClaudeProcessManager';

// Per-socket token bucket for message-send events.
// Each socket gets WS_MSG_BURST tokens that refill at WS_MSG_RATE per second.
const WS_MSG_BURST = 10;
const WS_MSG_RATE = 0.5; // 0.5 tokens/sec → steady-state ~30 msg/min

// Per-socket idempotency: remember the last N clientMessageIds so a client's
// retry during a network blip doesn't submit the same message twice.
const SEEN_IDS_CAPACITY = 64;

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

function makeBucket(): TokenBucket {
  return { tokens: WS_MSG_BURST, lastRefill: Date.now() };
}

function takeToken(bucket: TokenBucket): boolean {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(WS_MSG_BURST, bucket.tokens + elapsed * WS_MSG_RATE);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// LRU-ish Set: insertion order is preserved, we evict the oldest when we exceed capacity.
function rememberId(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_IDS_CAPACITY) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

// Authorization helper: owner OR admin may access a session.
// Returns false on any DB error (fail-closed).
function canAccessSession(sessionId: string, userId: string): boolean {
  if (!sessionId || !userId) return false;
  try {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT 1 FROM sessions s
         WHERE s.id = ?
           AND (s.user_id = ? OR EXISTS (
             SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin'
           ))`
      )
      .get(sessionId, userId, userId);
    return !!row;
  } catch (err) {
    console.error(`[WS] canAccessSession check failed sessionId=${sessionId} userId=${userId}:`, err);
    return false;
  }
}

// Authorization helper for write/control operations: owner ONLY (no admin bypass).
// Admins may observe (subscribe/reconnect via canAccessSession) but must not drive
// someone else's session. ProcessManager enforces the same rule downstream; this
// is the outer layer so unauthorized writes never touch in-memory state like
// pendingModes (which sits upstream of startSession's DB check).
function canControlSession(sessionId: string, userId: string): boolean {
  if (!sessionId || !userId) return false;
  try {
    const db = getDatabase();
    const row = db
      .prepare(`SELECT 1 FROM sessions WHERE id = ? AND user_id = ?`)
      .get(sessionId, userId);
    return !!row;
  } catch (err) {
    console.error(`[WS] canControlSession check failed sessionId=${sessionId} userId=${userId}:`, err);
    return false;
  }
}

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

    // Per-socket rate limit bucket for outbound messages to Claude.
    const messageBucket = makeBucket();
    // Per-socket seen clientMessageIds (for idempotent session:send retries).
    const seenSendIds = new Set<string>();

    const rateLimited = (sessionId: string, event: string): boolean => {
      if (takeToken(messageBucket)) return false;
      console.warn(
        `[WS] RATE_LIMITED event=${event} userId=${socket.data.userId} socketId=${socket.id}`
      );
      socket.emit('session:error', { sessionId, error: 'Rate limit exceeded. Slow down.' });
      return true;
    };

    // Debug: Log all incoming events
    socket.onAny((eventName, ...args) => {
      console.log(`[SOCKET EVENT] ${eventName}:`, args[0]?.sessionId || '', args[0]?.message?.substring(0, 30) || '');
    });

    // Subscribe to session output
    socket.on('session:subscribe', (sessionId) => {
      if (!canAccessSession(sessionId, socket.data.userId)) {
        console.warn(
          `[WS] DENIED session:subscribe userId=${socket.data.userId} sessionId=${sessionId}`
        );
        socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
        return;
      }
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} subscribed to session ${sessionId}`);
    });

    // Unsubscribe from session output
    socket.on('session:unsubscribe', (sessionId) => {
      socket.data.subscribedSessions.delete(sessionId);
      socket.leave(`session:${sessionId}`);
      console.log(`Socket ${socket.id} unsubscribed from session ${sessionId}`);

      // If the last subscriber just left, mark the session disconnected so the
      // idle-cleanup job can reclaim it. Otherwise the process + its buffer live
      // on forever after the only client navigated away.
      const roomSize = io.sockets.adapter.rooms.get(`session:${sessionId}`)?.size ?? 0;
      if (roomSize === 0) {
        processManager.markSessionDisconnected(sessionId);
      }
    });

    const logError = (event: string, sessionId: string, err: unknown): string => {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(
        `[WS ERROR] event=${event} sessionId=${sessionId} userId=${socket.data.userId} socketId=${socket.id}`,
        stack || message
      );
      return message;
    };

    const denyControl = (sessionId: string, event: string): boolean => {
      if (canControlSession(sessionId, socket.data.userId)) return false;
      console.warn(
        `[WS] DENIED ${event} userId=${socket.data.userId} sessionId=${sessionId}`
      );
      socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
      return true;
    };

    // Send message to Claude
    socket.on('session:send', async ({ sessionId, message, images, clientMessageId }) => {
      // Dedupe BEFORE rate-limiting: a retried message should not burn a token.
      if (clientMessageId && !rememberId(seenSendIds, clientMessageId)) {
        console.log(
          `[WS] session:send dedup clientMessageId=${clientMessageId} sessionId=${sessionId}`
        );
        return;
      }
      if (denyControl(sessionId, 'session:send')) return;
      if (rateLimited(sessionId, 'session:send')) return;
      console.log(`Received session:send for ${sessionId}: "${message?.substring(0, 50)}..."`);
      try {
        await processManager.sendMessage(sessionId, socket.data.userId, message, images);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:send', sessionId, err) || 'Failed to send message',
        });
      }
    });

    // Interrupt Claude session
    socket.on('session:interrupt', (sessionId) => {
      if (denyControl(sessionId, 'session:interrupt')) return;
      try {
        processManager.interrupt(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:interrupt', sessionId, err) || 'Failed to interrupt session',
        });
      }
    });

    // Set session permission mode
    socket.on('session:set-mode', ({ sessionId, mode }) => {
      if (denyControl(sessionId, 'session:set-mode')) return;
      console.log(`Setting session ${sessionId} mode to ${mode}`);
      try {
        processManager.setMode(sessionId, socket.data.userId, mode);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:set-mode', sessionId, err) || 'Failed to set mode',
        });
      }
    });

    // Restart session (stop and start fresh)
    socket.on('session:restart', async (sessionId) => {
      if (denyControl(sessionId, 'session:restart')) return;
      console.log(`Restart request for session ${sessionId}`);
      try {
        await processManager.restartSession(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:restart', sessionId, err) || 'Failed to restart session',
        });
      }
    });

    // Send raw input for interactive prompts (trust dialogs, etc.)
    socket.on('session:input', async ({ sessionId, input }) => {
      if (denyControl(sessionId, 'session:input')) return;
      if (rateLimited(sessionId, 'session:input')) return;
      console.log(`Received session:input for ${sessionId}: "${input}"`);
      try {
        await processManager.sendRawInput(sessionId, socket.data.userId, input);
        console.log(`Input sent successfully to session ${sessionId}`);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:input', sessionId, err) || 'Failed to send input',
        });
      }
    });

    // Approve permission request
    socket.on('session:approve_permission', async ({ sessionId, toolNames, originalMessage }) => {
      if (denyControl(sessionId, 'session:approve_permission')) return;
      console.log(`Received session:approve_permission for ${sessionId}: tools=${toolNames.join(', ')}`);
      try {
        await processManager.approvePermission(sessionId, socket.data.userId, toolNames, originalMessage);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:approve_permission', sessionId, err) || 'Failed to approve permission',
        });
      }
    });

    // Deny permission request
    socket.on('session:deny_permission', ({ sessionId }) => {
      if (denyControl(sessionId, 'session:deny_permission')) return;
      console.log(`Received session:deny_permission for ${sessionId}`);
      try {
        processManager.denyPermission(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:deny_permission', sessionId, err) || 'Failed to deny permission',
        });
      }
    });

    // Reconnect to a running session
    socket.on('session:reconnect', async ({ sessionId, lastTimestamp }) => {
      console.log(`Reconnect request for session ${sessionId} from socket ${socket.id}`);

      if (!canAccessSession(sessionId, socket.data.userId)) {
        console.warn(
          `[WS] DENIED session:reconnect userId=${socket.data.userId} sessionId=${sessionId}`
        );
        socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
        return;
      }

      // ALWAYS subscribe to the session room, regardless of running state
      // This ensures the socket receives events when a session starts
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} joined session room ${sessionId}`);

      const isRunning = processManager.isSessionRunning(sessionId);

      if (isRunning) {
        processManager.markSessionReconnected(sessionId);

        // getSessionBufferStatus signals needsFullResync when the circular buffer rolled
        // over since lastTimestamp — client should then fetch full state via REST instead
        // of trusting the truncated replay.
        const { items: bufferedMessages, needsFullResync } = processManager.getSessionBufferStatus(
          sessionId,
          lastTimestamp
        );

        console.log(
          `Session ${sessionId} reconnected with ${bufferedMessages.length} buffered messages (needsFullResync=${needsFullResync})`
        );

        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages,
          isRunning: true,
          needsFullResync,
        });
      } else {
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
