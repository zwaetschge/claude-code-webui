import { Router, Request, Response } from 'express';
import { getWatchdog } from '../services/watchdog/WatchdogService';
import type { WatchdogAutonomousProfile, WatchdogConfig, WatchdogCliConfig, WatchdogRule, TelegramConfig } from '@claude-code-webui/shared';
import { DEFAULT_WATCHDOG_RULES } from '@claude-code-webui/shared';

const router = Router();

// Get global watchdog status
router.get('/status', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json(watchdog.getStatus());
});

// Get global config
router.get('/config', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json(watchdog.getGlobalConfig());
});

// Update global config
router.put('/config', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const config = req.body as WatchdogConfig;
  watchdog.setGlobalConfig(config);
  res.json({ success: true });
});

// Enable/disable watchdog globally
router.post('/toggle', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { enabled } = req.body as { enabled: boolean };
  const config = watchdog.getGlobalConfig();
  config.enabled = enabled;
  watchdog.setGlobalConfig(config);
  res.json({ success: true, enabled });
});

// Set autonomous profile globally or per session
router.post('/profile', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { profile, sessionId } = req.body as { profile?: WatchdogAutonomousProfile; sessionId?: string };
  if (profile !== 'balanced' && profile !== 'aggressive') {
    return res.status(400).json({ error: 'Invalid profile. Expected "balanced" or "aggressive".' });
  }
  watchdog.setAutonomousProfile(profile, sessionId);
  res.json({ success: true, profile, sessionId });
});

router.post('/session/:sessionId/profile', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { profile } = req.body as { profile?: WatchdogAutonomousProfile };
  if (profile !== 'balanced' && profile !== 'aggressive') {
    return res.status(400).json({ error: 'Invalid profile. Expected "balanced" or "aggressive".' });
  }
  watchdog.setAutonomousProfile(profile, sessionId);
  res.json({ success: true, profile, sessionId });
});

// ===== Session Monitoring =====

router.post('/session/:sessionId/monitor', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { monitored } = req.body as { monitored: boolean };
  watchdog.setSessionMonitored(sessionId, monitored);
  res.json({ success: true, monitored });
});

// ===== Session Config =====

router.get('/session/:sessionId/config', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const config = watchdog.getSessionConfig(sessionId);
  res.json(config || { enabled: false, autonomousProfile: 'balanced', rules: [], logDecisions: true });
});

router.put('/session/:sessionId/config', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const config = req.body as WatchdogConfig | null;
  watchdog.setSessionConfig(sessionId, config);
  res.json({ success: true });
});

// ===== Goals =====

router.get('/session/:sessionId/goals', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  res.json(watchdog.getGoals(sessionId));
});

router.post('/session/:sessionId/goals', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const goal = watchdog.addGoal(sessionId, req.body);
  res.json(goal);
});

router.put('/session/:sessionId/goals/:goalId', (req: Request<{ sessionId: string; goalId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, goalId } = req.params;
  const goal = watchdog.updateGoal(sessionId, goalId, req.body);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  res.json(goal);
});

router.delete('/session/:sessionId/goals/:goalId', (req: Request<{ sessionId: string; goalId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, goalId } = req.params;
  const deleted = watchdog.deleteGoal(sessionId, goalId);
  if (!deleted) return res.status(404).json({ error: 'Goal not found' });
  res.json({ success: true });
});

// ===== Goal Monitoring =====

router.post('/session/:sessionId/goals/:goalId/monitor', (req: Request<{ sessionId: string; goalId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, goalId } = req.params;
  const { enabled } = req.body as { enabled: boolean };
  if (enabled) {
    watchdog.startGoalMonitoring(sessionId, goalId);
  } else {
    watchdog.stopGoalMonitoring(sessionId, goalId);
  }
  res.json({ success: true, monitoring: enabled });
});

router.post('/session/:sessionId/instruct', async (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { message, createGoal } = req.body as { message: string; createGoal?: boolean };
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const result = await watchdog.instructSession(sessionId, message, createGoal !== false);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Instruction failed' });
  }
});

// ===== Decisions =====

router.get('/decisions', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, limit } = req.query;
  const decisions = watchdog.getDecisions(
    sessionId as string | undefined,
    limit ? parseInt(limit as string, 10) : 100
  );
  res.json(decisions);
});

router.get('/audit', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, limit } = req.query;
  const audit = watchdog.getAudit(
    sessionId as string | undefined,
    limit ? parseInt(limit as string, 10) : 200
  );
  res.json(audit);
});

router.get('/session/:sessionId/audit', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { limit } = req.query;
  const audit = watchdog.getAudit(
    sessionId,
    limit ? parseInt(limit as string, 10) : 200
  );
  res.json(audit);
});

router.get('/session/:sessionId/decisions', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { limit } = req.query;
  res.json(watchdog.getDecisions(sessionId, limit ? parseInt(limit as string, 10) : 100));
});

// ===== Session Pause/Resume =====

router.post('/session/:sessionId/pause', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  const { reason } = req.body as { reason?: string };
  watchdog.pauseSession(sessionId, reason || 'Manually paused');
  res.json({ success: true });
});

router.post('/session/:sessionId/resume', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  watchdog.resumeSession(sessionId);
  res.json({ success: true });
});

// ===== Rules =====

router.post('/rules', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { rule, sessionId } = req.body as { rule: WatchdogRule; sessionId?: string };
  watchdog.addRule(rule, sessionId);
  res.json({ success: true });
});

router.delete('/rules/:ruleId', (req: Request<{ ruleId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { ruleId } = req.params;
  const { sessionId } = req.query;
  watchdog.removeRule(ruleId, sessionId as string | undefined);
  res.json({ success: true });
});

router.post('/rules/:ruleId/toggle', (req: Request<{ ruleId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { ruleId } = req.params;
  const { enabled, sessionId } = req.body as { enabled: boolean; sessionId?: string };
  watchdog.toggleRule(ruleId, enabled, sessionId);
  res.json({ success: true });
});

router.get('/default-rules', (_req: Request, res: Response) => {
  res.json(DEFAULT_WATCHDOG_RULES);
});

// ===== Goal Monitoring Config =====

router.put('/goal-monitoring', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const goalMonitoring = req.body as { enabled: boolean; maxIterationsPerGoal: number; evaluationDelayMs: number; autoCreateFromSession: boolean };
  const config = watchdog.getGlobalConfig();
  config.goalMonitoring = goalMonitoring;
  watchdog.setGlobalConfig(config);
  res.json({ success: true });
});

// ===== Telegram =====

router.get('/telegram', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const config = watchdog.getTelegramConfig();
  // Hide bot token in response
  if (config?.botToken) {
    res.json({ ...config, botToken: config.botToken.substring(0, 8) + '...' });
  } else {
    res.json(config || { enabled: false });
  }
});

router.put('/telegram', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const config = req.body as TelegramConfig;
  watchdog.setTelegramConfig(config);
  res.json({ success: true });
});

router.post('/telegram/test', async (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const result = await watchdog.testTelegramConnection();
  res.json(result);
});

// ===== Chat =====

router.post('/chat', async (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { message, sessionId, context } = req.body as {
    message: string;
    sessionId?: string;
    context?: unknown;
  };
  try {
    const response = await Promise.resolve(watchdog.processChat(message, sessionId, context));
    res.json(response);
  } catch (err) {
    console.error('[WATCHDOG] Chat error:', err);
    res.status(500).json({ error: 'Chat processing failed' });
  }
});

// ===== CLI Config =====

router.get('/cli', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json(watchdog.getCliConfig_Public());
});

router.put('/cli', (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const config = req.body as WatchdogCliConfig;
  watchdog.setCliConfig(config);
  res.json({ success: true });
});

router.post('/cli/restart', async (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  try {
    await watchdog.restartCli();
    res.json({ success: true });
  } catch (err) {
    console.error('[WATCHDOG] CLI restart error:', err);
    res.status(500).json({ error: 'CLI restart failed' });
  }
});

// ===== Inter-Instance Communication =====

// Send message from Watchdog to a session
router.post('/send-to-session', async (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, message } = req.body as { sessionId: string; message: string };
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });
  try {
    const response = await watchdog.sendToSession(sessionId, message);
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send to session' });
  }
});

// Send guidance from Watchdog to a Ralph run
router.post('/send-to-ralph', async (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { runId, message } = req.body as { runId: string; message: string };
  if (!runId || !message) return res.status(400).json({ error: 'runId and message required' });
  try {
    const response = await watchdog.sendGuidanceToRalph(runId, message);
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send to Ralph' });
  }
});

// A session consults the Watchdog for advice
router.post('/consult', async (req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId, question, source } = req.body as { sessionId: string; question: string; source?: 'session' | 'ralph' };
  if (!sessionId || !question) return res.status(400).json({ error: 'sessionId and question required' });
  try {
    const response = await watchdog.consultWatchdog(sessionId, question, source || 'session');
    res.json({ success: true, response });
  } catch (err) {
    res.status(500).json({ error: 'Consultation failed' });
  }
});

// Assess a session (Watchdog AI analysis)
router.post('/assess/:sessionId', async (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { sessionId } = req.params;
  try {
    const assessment = await watchdog.assessSession(sessionId);
    res.json({ success: true, assessment });
  } catch (err) {
    res.status(500).json({ error: 'Assessment failed' });
  }
});

// Get inter-instance message log
router.get('/inter-messages', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  const { limit } = _req.query;
  res.json(watchdog.getInterMessages(limit ? parseInt(limit as string, 10) : 50));
});

// Get session activity feed
router.get('/activity', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json(watchdog.getAllActivity());
});

router.get('/activity/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json(watchdog.getSessionActivity(req.params.sessionId));
});

// Telegram bot control
router.post('/telegram/bot/start', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  watchdog.startTelegramBot();
  res.json({ success: true, running: watchdog.isTelegramBotRunning() });
});

router.post('/telegram/bot/stop', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  watchdog.stopTelegramBot();
  res.json({ success: true, running: false });
});

router.get('/telegram/bot/status', (_req: Request, res: Response) => {
  const watchdog = getWatchdog();
  if (!watchdog) return res.status(503).json({ error: 'Watchdog service not initialized' });
  res.json({ running: watchdog.isTelegramBotRunning() });
});

export default router;
