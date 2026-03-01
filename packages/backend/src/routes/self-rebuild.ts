import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { triggerRebuild, getRebuildStatus, isRebuildInProgress, getLastRebuildResult, getRobotStatus, getRobotReport, startRobot, getRobotContainerInfo } from '../services/self-rebuild';

const router = Router();

const triggerSchema = z.object({
  noCache: z.boolean().optional(),
});

// Trigger a rebuild
router.post('/trigger', requireAuth, async (req, res) => {
  const parsed = triggerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const result = await triggerRebuild({ noCache: parsed.data.noCache });

  if (!result.success) {
    res.status(429).json({
      success: false,
      message: result.message,
    });
    return;
  }

  res.json({
    success: true,
    message: result.message,
  });
});

// Get current rebuild status
router.get('/status', requireAuth, (_req, res) => {
  const status = getRebuildStatus();
  res.json(status);
});

// Check if rebuild is in progress (lightweight endpoint)
router.get('/in-progress', requireAuth, (_req, res) => {
  res.json({ inProgress: isRebuildInProgress() });
});

// Get last rebuild result (persisted across restarts)
router.get('/last-result', requireAuth, async (_req, res) => {
  const result = await getLastRebuildResult();
  res.json({ success: true, data: result });
});

// Get Rebuild Robot status (with container info)
router.get('/robot/status', requireAuth, async (_req, res) => {
  const [status, containerInfo] = await Promise.all([
    getRobotStatus(),
    getRobotContainerInfo(),
  ]);
  res.json({
    success: true,
    data: status,
    robotAvailable: containerInfo.containerRunning || containerInfo.heartbeatActive,
    container: containerInfo,
  });
});

// Start the rebuild-robot sidecar container
router.post('/robot/start', requireAuth, async (_req, res) => {
  const result = await startRobot();
  res.status(result.success ? 200 : 400).json(result);
});

// Get Rebuild Robot report
router.get('/robot/report', requireAuth, async (_req, res) => {
  const report = await getRobotReport();
  res.json({ success: true, data: report });
});

export default router;
