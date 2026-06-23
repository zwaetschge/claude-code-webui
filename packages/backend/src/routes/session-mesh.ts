import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { auditFromRequest } from '../utils/auditLog';
import { peerService } from '../services/session-mesh/PeerService';

const router = Router();

router.use(requireAuth);

function authUserId(req: Request): string {
  return (req as unknown as AuthenticatedRequest).userId;
}

const addPeerSchema = z.object({
  targetSessionId: z.string().trim().min(1).max(100),
  role: z.string().trim().max(160).nullable().optional(),
});

const createDelegationSchema = z.object({
  toSessionId: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(50_000),
  kind: z.enum(['message', 'consult', 'watchdog-consult']).optional().default('consult'),
});

const replyDelegationSchema = z.object({
  result: z.string().trim().min(1).max(50_000),
});

router.get('/sessions/:id/peers', (req, res) => {
  const userId = authUserId(req);
  res.json({ success: true, data: peerService.listPeers(req.params.id!, userId) });
});

router.post('/sessions/:id/peers', (req, res) => {
  const parsed = addPeerSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid peer payload', 400, 'VALIDATION_ERROR');
  const userId = authUserId(req);
  const peer = peerService.addPeer({
    sourceSessionId: req.params.id!,
    targetSessionId: parsed.data.targetSessionId,
    userId,
    role: parsed.data.role,
  });
  auditFromRequest(req, 'session_mesh.peer_linked', {
    resourceType: 'session',
    resourceId: req.params.id,
    metadata: { targetSessionId: parsed.data.targetSessionId },
  });
  res.status(201).json({ success: true, data: peer });
});

router.delete('/sessions/:id/peers/:peerSessionId', (req, res) => {
  const userId = authUserId(req);
  peerService.removePeer(req.params.id!, req.params.peerSessionId!, userId);
  auditFromRequest(req, 'session_mesh.peer_unlinked', {
    resourceType: 'session',
    resourceId: req.params.id,
    metadata: { targetSessionId: req.params.peerSessionId },
  });
  res.json({ success: true });
});

router.get('/sessions/:id/delegations', (req, res) => {
  const userId = authUserId(req);
  res.json({ success: true, data: peerService.listDelegations(req.params.id!, userId) });
});

router.post(
  '/sessions/:id/delegations',
  asyncHandler(async (req, res) => {
    const parsed = createDelegationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid delegation payload', 400, 'VALIDATION_ERROR');
    }
    const userId = authUserId(req);
    const delegation = await peerService.createDelegation({
      fromSessionId: req.params.id!,
      toSessionId: parsed.data.toSessionId,
      userId,
      content: parsed.data.content,
      kind: parsed.data.kind,
    });
    auditFromRequest(req, 'session_mesh.delegation_created', {
      resourceType: 'session_delegation',
      resourceId: delegation.id,
      metadata: {
        fromSessionId: req.params.id,
        toSessionId: parsed.data.toSessionId,
        status: delegation.status,
      },
    });
    res.status(202).json({ success: true, data: delegation });
  })
);

router.post('/delegations/:id/cancel', (req, res) => {
  const userId = authUserId(req);
  const delegation = peerService.cancelDelegation(req.params.id!, userId);
  auditFromRequest(req, 'session_mesh.delegation_cancelled', {
    resourceType: 'session_delegation',
    resourceId: delegation.id,
  });
  res.json({ success: true, data: delegation });
});

router.post('/delegations/:id/reply', (req, res) => {
  const parsed = replyDelegationSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid reply payload', 400, 'VALIDATION_ERROR');
  const userId = authUserId(req);
  const delegation = peerService.replyToDelegation(req.params.id!, userId, parsed.data.result);
  auditFromRequest(req, 'session_mesh.delegation_replied', {
    resourceType: 'session_delegation',
    resourceId: delegation.id,
  });
  res.json({ success: true, data: delegation });
});

export default router;
