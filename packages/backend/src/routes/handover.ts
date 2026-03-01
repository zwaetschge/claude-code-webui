import { Router } from 'express';
import type { Server } from 'socket.io';
import { getProcessManager } from '../websocket';
import type { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '@claude-code-webui/shared';

const router = Router();

const startTime = Date.now();

/**
 * GET /api/handover/status
 * Returns container status for the other container to check before handover.
 * No auth required — only accessible on internal docker network.
 */
router.get('/status', (_req, res) => {
  const processManager = getProcessManager();
  const activeSessionIds = processManager.getRunningSessionIds();

  res.json({
    container: process.env.CONTAINER_NAME || 'unknown',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeSessions: activeSessionIds.length,
    activeSessionIds,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/handover/prepare-shutdown
 * Signals this container that it will be stopped soon.
 * Broadcasts shutdown warning to all connected WebSocket clients.
 * No auth required — only accessible on internal docker network.
 */
router.post('/prepare-shutdown', (req, res) => {
  const io = req.app.get('io') as Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | undefined;
  const processManager = getProcessManager();
  const activeSessionIds = processManager.getRunningSessionIds();
  const reason = req.body?.reason || 'restart';

  const containerName = process.env.CONTAINER_NAME || 'unknown';
  console.log(`[handover] Shutdown vorbereitet für ${containerName}. Grund: ${reason}. Aktive Sessions: ${activeSessionIds.length}`);

  // Broadcast shutdown warning to all connected clients
  if (io) {
    io.emit('self-rebuild:status', {
      status: 'restarting',
      progress: `Container ${containerName} wird neugestartet (${reason}). ${activeSessionIds.length} aktive Session(s).`,
    });
  }

  res.json({
    container: containerName,
    activeSessions: activeSessionIds.length,
    activeSessionIds,
    acknowledged: true,
    timestamp: new Date().toISOString(),
  });
});

export default router;
