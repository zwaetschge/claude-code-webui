import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { addPatternToSettings } from './claude-settings';
import { getDatabase } from '../db';
import { config } from '../config';
import { opencodeServer } from '../services/opencode/OpencodeServer';
import { auditFromRequest, recordAudit } from '../utils/auditLog';

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

// Hook-only endpoints (request creation + long-polling response) are reachable from any
// caller that can hit the backend — including the public internet once the port is
// exposed. They must only accept calls from our own permission-prompt script, which
// receives the secret via env. We compare with constant-time to not leak length.
function requireHookSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-webui-hook-secret') || '';
  const expected = config.hookSecret;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

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
  requestId: z.string().min(1),
  action: z.enum(['allow_once', 'allow_project', 'allow_global', 'deny']),
  pattern: z.string().optional(),
});

/**
 * POST /api/permissions/request
 * Called by the permission-prompt script when Claude needs permission.
 * Stores the request and emits to frontend.
 * Requires the shared hook secret, which the spawning backend injects
 * into the script's env so no external caller can forge requests.
 */
router.post('/request', requireHookSecret, async (req: Request, res: Response) => {
  const parsed = permissionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, toolName, toolInput, description, suggestedPattern } = parsed.data;

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

  const db = getDatabase();
  const session = db
    .prepare('SELECT user_id, cli_provider FROM sessions WHERE id = ?')
    .get(sessionId) as { user_id: string; cli_provider: string | null } | undefined;
  recordAudit({
    actorUserId: session?.user_id ?? null,
    action: 'permission.request',
    resourceType: 'session',
    resourceId: sessionId,
    metadata: {
      provider: session?.cli_provider || 'unknown',
      requestId,
      toolName,
      suggestedPattern: pendingRequest.suggestedPattern,
      description: pendingRequest.description,
    },
  });

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
 * Requires the shared hook secret — same rationale as /request.
 */
router.get('/response/:requestId', requireHookSecret, async (req: Request, res: Response) => {
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
    try {
      const reply =
        action === 'deny'
          ? 'reject'
          : action === 'allow_global' || action === 'allow_project'
            ? 'always'
            : 'once';
      const handled = await opencodeServer.replyPermission(requestId, reply, pattern);
      if (handled) {
        auditFromRequest(req, 'permission.respond', {
          resourceType: 'permission_request',
          resourceId: requestId,
          metadata: {
            provider: 'opencode',
            action,
            pattern: pattern ?? null,
          },
        });
        return res.json({
          success: true,
          action,
          pattern,
          provider: 'opencode',
        });
      }
    } catch (err) {
      console.error(`[PERMISSIONS] OpenCode permission reply failed for ${requestId}:`, err);
      throw new AppError('Failed to respond to OpenCode permission request', 502, 'OPENCODE_ERROR');
    }

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
  auditFromRequest(req, 'permission.respond', {
    resourceType: 'session',
    resourceId: request.sessionId,
    metadata: {
      provider: 'hook',
      requestId,
      toolName: request.toolName,
      action,
      pattern: request.pattern ?? pattern ?? null,
    },
  });

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
