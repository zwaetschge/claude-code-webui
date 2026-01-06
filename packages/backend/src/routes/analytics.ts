import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get usage summary (totals across all sessions)
router.get('/summary', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { period = '7d' } = req.query;

  // Calculate date range
  let dateFilter = '';
  switch (period) {
    case '24h':
      dateFilter = `AND created_at >= datetime('now', '-1 day')`;
      break;
    case '7d':
      dateFilter = `AND created_at >= datetime('now', '-7 days')`;
      break;
    case '30d':
      dateFilter = `AND created_at >= datetime('now', '-30 days')`;
      break;
    case 'all':
      dateFilter = '';
      break;
    default:
      dateFilter = `AND created_at >= datetime('now', '-7 days')`;
  }

  try {
    // Get totals
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(*) as total_requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter}
    `).get(authReq.userId) as {
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_creation_tokens: number;
      total_tokens: number;
      total_cost: number;
      total_requests: number;
    };

    // Get per-model breakdown
    const byModel = db.prepare(`
      SELECT
        model,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter}
      GROUP BY model
      ORDER BY cost DESC
    `).all(authReq.userId);

    // Get per-session breakdown (top 10)
    const bySession = db.prepare(`
      SELECT
        uh.session_id,
        s.name as session_name,
        COALESCE(SUM(uh.total_tokens), 0) as total_tokens,
        COALESCE(SUM(uh.cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history uh
      LEFT JOIN sessions s ON s.id = uh.session_id
      WHERE uh.user_id = ? ${dateFilter}
      GROUP BY uh.session_id
      ORDER BY cost DESC
      LIMIT 10
    `).all(authReq.userId);

    res.json({
      success: true,
      data: {
        period,
        totals: {
          inputTokens: totals.total_input_tokens,
          outputTokens: totals.total_output_tokens,
          cacheReadTokens: totals.total_cache_read_tokens,
          cacheCreationTokens: totals.total_cache_creation_tokens,
          totalTokens: totals.total_tokens,
          totalCost: totals.total_cost,
          totalRequests: totals.total_requests,
        },
        byModel,
        bySession,
      },
    });
  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch analytics' } });
  }
});

// Get usage over time (for charts)
router.get('/timeline', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { period = '7d', granularity = 'day' } = req.query;

  // Calculate date range and grouping
  let dateFilter = '';
  let dateFormat = '';

  switch (period) {
    case '24h':
      dateFilter = `AND created_at >= datetime('now', '-1 day')`;
      dateFormat = granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
      break;
    case '7d':
      dateFilter = `AND created_at >= datetime('now', '-7 days')`;
      dateFormat = '%Y-%m-%d';
      break;
    case '30d':
      dateFilter = `AND created_at >= datetime('now', '-30 days')`;
      dateFormat = '%Y-%m-%d';
      break;
    case 'all':
      dateFilter = '';
      dateFormat = '%Y-%m';
      break;
    default:
      dateFilter = `AND created_at >= datetime('now', '-7 days')`;
      dateFormat = '%Y-%m-%d';
  }

  try {
    const timeline = db.prepare(`
      SELECT
        strftime('${dateFormat}', created_at) as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter}
      GROUP BY strftime('${dateFormat}', created_at)
      ORDER BY date ASC
    `).all(authReq.userId);

    res.json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    console.error('Error fetching analytics timeline:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch timeline' } });
  }
});

// Get session-specific analytics
router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { sessionId } = req.params;

  try {
    // Verify session belongs to user
    const session = db.prepare(
      'SELECT id, name FROM sessions WHERE id = ? AND user_id = ?'
    ).get(sessionId, authReq.userId) as { id: string; name: string } | undefined;

    if (!session) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    // Get session totals
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(*) as total_requests
      FROM usage_history
      WHERE session_id = ?
    `).get(sessionId) as {
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_creation_tokens: number;
      total_tokens: number;
      total_cost: number;
      total_requests: number;
    };

    // Get usage history for this session
    const history = db.prepare(`
      SELECT
        id,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        total_tokens,
        cost_usd as cost,
        model,
        created_at
      FROM usage_history
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(sessionId);

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          name: session.name,
        },
        totals: {
          inputTokens: totals.total_input_tokens,
          outputTokens: totals.total_output_tokens,
          cacheReadTokens: totals.total_cache_read_tokens,
          cacheCreationTokens: totals.total_cache_creation_tokens,
          totalTokens: totals.total_tokens,
          totalCost: totals.total_cost,
          totalRequests: totals.total_requests,
        },
        history,
      },
    });
  } catch (error) {
    console.error('Error fetching session analytics:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch session analytics' } });
  }
});

// Record usage (internal use - called from ClaudeProcessManager)
router.post('/record', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { sessionId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens, costUsd, model } = req.body;

  try {
    const id = db.prepare(`
      INSERT INTO usage_history (user_id, session_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      authReq.userId,
      sessionId,
      inputTokens || 0,
      outputTokens || 0,
      cacheReadTokens || 0,
      cacheCreationTokens || 0,
      totalTokens || 0,
      costUsd || 0,
      model || 'unknown'
    );

    res.json({ success: true, data: { id: id.lastInsertRowid } });
  } catch (error) {
    console.error('Error recording usage:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to record usage' } });
  }
});

export default router;
