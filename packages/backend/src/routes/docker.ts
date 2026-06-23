import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { dockerHost } from '../services/docker';
import { watchdogService } from '../services/watchdogs/WatchdogService';

const router = Router();

router.use(requireAuth, requireAdmin);

function authUserId(req: Request): string {
  return (req as unknown as AuthenticatedRequest).userId;
}

const logsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(500).default(120),
});

function requireContainerId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new AppError('Container id is required', 400, 'VALIDATION_ERROR');
  if (trimmed.length > 160) {
    throw new AppError('Container id is too long', 400, 'VALIDATION_ERROR');
  }
  return trimmed;
}

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await dockerHost.status() });
  })
);

router.get(
  '/containers',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await dockerHost.listContainers() });
  })
);

router.get(
  '/containers/:id/logs',
  asyncHandler(async (req, res) => {
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError('Invalid logs query', 400, 'VALIDATION_ERROR');
    const containerId = requireContainerId(req.params.id);
    res.json({
      success: true,
      data: await dockerHost.getContainerLogs(containerId, parsed.data.tail),
    });
  })
);

router.get(
  '/containers/:id/stats',
  asyncHandler(async (req, res) => {
    const containerId = requireContainerId(req.params.id);
    res.json({ success: true, data: await dockerHost.getContainerStats(containerId) });
  })
);

router.post(
  '/containers/:id/snapshot',
  asyncHandler(async (req, res) => {
    const containerId = requireContainerId(req.params.id);
    const userId = authUserId(req);
    res.json({
      success: true,
      data: await watchdogService.snapshot(null, userId, containerId),
    });
  })
);

router.get(
  '/containers/:id',
  asyncHandler(async (req, res) => {
    const containerId = requireContainerId(req.params.id);
    res.json({ success: true, data: await dockerHost.inspectContainer(containerId) });
  })
);

export default router;
