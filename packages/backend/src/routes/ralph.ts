import { Router, Request, Response } from 'express';
import { getRalph } from '../services/ralph';
import type { RalphConfig } from '@claude-code-webui/shared';

const router = Router();

function requireRalph(res: Response) {
  const ralph = getRalph();
  if (!ralph) {
    res.status(503).json({ error: 'Ralph service not initialized' });
    return null;
  }
  return ralph;
}

// Start a new Ralph run
router.post('/start', async (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const { userId, idea, config } = req.body as {
    userId: string;
    idea: string;
    config?: Partial<RalphConfig>;
  };

  if (!userId || !idea) {
    return res.status(400).json({ error: 'userId and idea are required' });
  }

  try {
    const run = await ralph.startRun(userId, idea, config);
    res.json({ success: true, run });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to start run',
    });
  }
});

// Get all runs
router.get('/runs', (_req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  res.json(ralph.getAllRuns());
});

// Get a specific run
router.get('/runs/:runId', (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const runId = req.params.runId as string;
  const run = ralph.getRunState(runId);
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }
  res.json(run);
});

// Get active run for a session
router.get('/session/:sessionId', (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const sessionId = req.params.sessionId as string;
  const run = ralph.getRunBySession(sessionId);
  res.json(run || null);
});

// Pause a run
router.post('/runs/:runId/pause', async (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const runId = req.params.runId as string;
  try {
    await ralph.pauseRun(runId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to pause run',
    });
  }
});

// Resume a run
router.post('/runs/:runId/resume', async (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const runId = req.params.runId as string;
  try {
    await ralph.resumeRun(runId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to resume run',
    });
  }
});

// Stop a run
router.post('/runs/:runId/stop', async (req: Request, res: Response) => {
  const ralph = requireRalph(res);
  if (!ralph) return;

  const runId = req.params.runId as string;
  try {
    await ralph.stopRun(runId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to stop run',
    });
  }
});

export default router;
