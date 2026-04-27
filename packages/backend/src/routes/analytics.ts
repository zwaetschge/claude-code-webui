import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Parse a signed-minute TZ offset (e.g. "120" for UTC+2, "-300" for UTC-5) into
// a SQLite strftime modifier. Returns '0 minutes' (no-op) on missing/invalid input,
// so day grouping falls back to UTC — which matches the pre-D9 behavior.
function parseTzModifier(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '0 minutes';
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < -840 || n > 840) return '0 minutes';
  return `${n >= 0 ? '+' : ''}${n} minutes`;
}

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

    // Get per-session breakdown. Capped at 50 so the frontend's paginated
    // "Top Sessions" list has rows to reveal beyond the default 10 — without
    // flooding the response with every session that ever ran a request.
    // Use fully qualified column name for created_at to avoid ambiguity with sessions table
    const sessionDateFilter = dateFilter.replace('created_at', 'uh.created_at');
    const bySession = db.prepare(`
      SELECT
        uh.session_id,
        s.name as session_name,
        COALESCE(SUM(uh.total_tokens), 0) as total_tokens,
        COALESCE(SUM(uh.cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history uh
      LEFT JOIN sessions s ON s.id = uh.session_id
      WHERE uh.user_id = ? ${sessionDateFilter}
      GROUP BY uh.session_id
      ORDER BY cost DESC
      LIMIT 50
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
  const { period = '7d', granularity = 'day', tz } = req.query;
  const tzModifier = parseTzModifier(tz);

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
        strftime('${dateFormat}', created_at, ?) as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter}
      GROUP BY strftime('${dateFormat}', created_at, ?)
      ORDER BY date ASC
    `).all(tzModifier, authReq.userId, tzModifier);

    const providerRows = db.prepare(`
      SELECT
        strftime('${dateFormat}', created_at, ?) as date,
        model,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter}
      GROUP BY strftime('${dateFormat}', created_at, ?), model
      ORDER BY date ASC
    `).all(tzModifier, authReq.userId, tzModifier) as Array<{
      date: string;
      model: string | null;
      total_tokens: number;
      cost: number;
      requests: number;
    }>;

    const getProviderLabel = (model?: string | null): string => {
      const value = (model || '').toLowerCase();
      if (!value) return 'Other';
      if (value.includes('gpt') || value.includes('codex')) return 'Codex';
      if (value.includes('claude')) return 'Claude';
      return 'Other';
    };

    const providersByDate = new Map<string, Record<string, { tokens: number; cost: number; requests: number }>>();
    for (const row of providerRows) {
      const provider = getProviderLabel(row.model);
      const current = providersByDate.get(row.date) || {};
      const entry = current[provider] || { tokens: 0, cost: 0, requests: 0 };
      entry.tokens += row.total_tokens;
      entry.cost += row.cost;
      entry.requests += row.requests;
      current[provider] = entry;
      providersByDate.set(row.date, current);
    }

    const timelineWithProviders = (timeline as Array<{ date: string }>).map((entry) => ({
      ...entry,
      providers: providersByDate.get(entry.date) || {},
    }));

    res.json({
      success: true,
      data: timelineWithProviders,
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
    // One round-trip: ownership check + totals in a single query. Returns null-row
    // when the session doesn't exist OR doesn't belong to the user.
    const sessionTotals = db.prepare(`
      SELECT
        s.id as session_id,
        s.name as session_name,
        COALESCE(SUM(uh.input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(uh.output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(uh.cache_read_tokens), 0) as total_cache_read_tokens,
        COALESCE(SUM(uh.cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(uh.total_tokens), 0) as total_tokens,
        COALESCE(SUM(uh.cost_usd), 0) as total_cost,
        COUNT(uh.id) as total_requests
      FROM sessions s
      LEFT JOIN usage_history uh ON uh.session_id = s.id AND uh.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
      GROUP BY s.id
    `).get(sessionId, authReq.userId) as {
      session_id: string;
      session_name: string;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_creation_tokens: number;
      total_tokens: number;
      total_cost: number;
      total_requests: number;
    } | undefined;

    if (!sessionTotals) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    const session = { id: sessionTotals.session_id, name: sessionTotals.session_name };
    const totals = sessionTotals;

    // Get usage history for this session — scoped by user_id too so a shared
    // session row can't leak rows that belong to another user.
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
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(sessionId, authReq.userId);

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
