import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { addPatternToSettings } from './claude-settings';
import { getDatabase } from '../db';

const router = Router();

// Types
interface PendingPermission {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
  status: 'pending' | 'approved' | 'denied';
  pattern?: string;
  createdAt: number;
}

// In-memory storage for pending permission requests
// Key: requestId, Value: PendingPermission
const pendingRequests = new Map<string, PendingPermission>();

// Cleanup old requests (older than 3 minutes)
function cleanupOldRequests(): void {
  const maxAge = 3 * 60 * 1000; // 3 minutes
  const now = Date.now();
  for (const [requestId, request] of pendingRequests.entries()) {
    if (now - request.createdAt > maxAge) {
      pendingRequests.delete(requestId);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupOldRequests, 60 * 1000);

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Validation schemas
const permissionRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.unknown(),
  description: z.string().optional(),
  suggestedPattern: z.string().optional(),
});

const permissionRespondSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['allow_once', 'allow_project', 'allow_global', 'deny']),
  pattern: z.string().optional(),
});

/**
 * POST /api/permissions/request
 * Called by the permission-prompt script when Claude needs permission.
 * Stores the request and emits to frontend via WebSocket.
 * No authentication required (called by local script).
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = permissionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, toolName, toolInput, description, suggestedPattern } = parsed.data;

  // Store the pending request
  const pendingRequest: PendingPermission = {
    sessionId,
    requestId,
    toolName,
    toolInput,
    description: description || `${toolName} tool`,
    suggestedPattern: suggestedPattern || `${toolName}(:*)`,
    status: 'pending',
    createdAt: Date.now(),
  };

  pendingRequests.set(requestId, pendingRequest);

  // Get Socket.IO instance and emit to frontend
  const io: Server = req.app.get('io');
  io.to(`session:${sessionId}`).emit('session:permission_request', {
    sessionId,
    requestId,
    toolName,
    toolInput,
    description: pendingRequest.description,
    suggestedPattern: pendingRequest.suggestedPattern,
  });

  console.log(`[PERMISSIONS] Request ${requestId} created for session ${sessionId}: ${toolName}`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/permissions/response/:requestId
 * Long-polled by the permission-prompt script to wait for user response.
 * No authentication required (called by local script).
 */
router.get('/response/:requestId', async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  if (!requestId) {
    return res.status(400).json({ approved: false, error: 'Missing requestId' });
  }

  const timeout = 120000; // 2 minute timeout

  const startTime = Date.now();

  // Poll until response or timeout
  while (Date.now() - startTime < timeout) {
    const request = pendingRequests.get(requestId);

    if (!request) {
      // Request not found - probably already cleaned up or never existed
      return res.json({
        approved: false,
        error: 'Request not found',
      });
    }

    if (request.status !== 'pending') {
      // User has responded
      const approved = request.status === 'approved';
      const pattern = request.pattern;

      // Clean up the request
      pendingRequests.delete(requestId);

      console.log(`[PERMISSIONS] Request ${requestId} resolved: ${request.status}`);

      return res.json({
        approved,
        pattern,
      });
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // Timeout - deny by default
  pendingRequests.delete(requestId);

  console.log(`[PERMISSIONS] Request ${requestId} timed out`);

  res.json({
    approved: false,
    error: 'Timeout',
  });
});

/**
 * POST /api/permissions/respond
 * Called by the frontend when user approves or denies a permission request.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = permissionRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { requestId, action, pattern } = parsed.data;

  const request = pendingRequests.get(requestId);

  if (!request) {
    throw new AppError('Permission request not found or expired', 404, 'NOT_FOUND');
  }

  // Update request status
  if (action === 'deny') {
    request.status = 'denied';
  } else {
    request.status = 'approved';
    request.pattern = pattern || request.suggestedPattern;

    // Save pattern if user selected allow_project or allow_global
    if (action === 'allow_project' || action === 'allow_global') {
      try {
        const scope = action === 'allow_global' ? 'global' : 'project';
        let projectPath: string | undefined;

        if (scope === 'project') {
          // Get project path from session
          const db = getDatabase();
          const session = db
            .prepare('SELECT working_directory FROM sessions WHERE id = ?')
            .get(request.sessionId) as { working_directory: string } | undefined;
          projectPath = session?.working_directory;
        }

        await addPatternToSettings(request.pattern!, scope, projectPath);
        console.log(`[PERMISSIONS] Saved pattern "${request.pattern}" to ${scope} settings`);
      } catch (err) {
        console.error(`[PERMISSIONS] Failed to save pattern:`, err);
        // Don't fail the request if pattern saving fails
      }
    }
  }

  console.log(`[PERMISSIONS] User responded to ${requestId}: ${action}`);

  // Note: The long-polling endpoint will pick up this status change
  // and return the response to the permission-prompt script

  res.json({
    success: true,
    action,
    pattern: request.pattern,
  });
});

/**
 * GET /api/permissions/pending/:sessionId
 * Get pending permission requests for a session.
 * Useful for frontend to check if there are outstanding requests.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const pending: PendingPermission[] = [];
  for (const request of pendingRequests.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }

  res.json({
    success: true,
    data: pending,
  });
});

export default router;
