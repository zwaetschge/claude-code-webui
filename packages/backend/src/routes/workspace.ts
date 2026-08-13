import { Router, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

/**
 * Session-adjacent features that share one shape: small user-scoped tables with
 * plain CRUD. Kept together so templates, the notification centre, push
 * subscriptions, cross-device drafts and turn diffs stay easy to compare.
 */
const router = Router();

const uid = (req: Request): string => (req as AuthenticatedRequest).userId;

/** Stored JSON blobs are never trusted enough to break a list response. */
function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Session templates
// ===========================================================================

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cliProvider: z.string().trim().max(40).nullable().optional(),
  cliModel: z.string().trim().max(200).nullable().optional(),
  cliReasoning: z.string().trim().max(40).nullable().optional(),
  mode: z.string().trim().max(40).nullable().optional(),
  workingDirectory: z.string().trim().max(1024).nullable().optional(),
  designStyleSkill: z.string().trim().max(200).nullable().optional(),
  writingStyleSkill: z.string().trim().max(200).nullable().optional(),
  surface: z.string().trim().max(20).optional(),
});

const TEMPLATE_COLUMNS = `id, name, cli_provider as cliProvider, cli_model as cliModel,
   cli_reasoning as cliReasoning, mode, working_directory as workingDirectory,
   design_style_skill as designStyleSkill, writing_style_skill as writingStyleSkill,
   surface, created_at as createdAt, updated_at as updatedAt`;

router.get(
  '/templates',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rows = getDatabase()
      .prepare(
        `SELECT ${TEMPLATE_COLUMNS} FROM session_templates
         WHERE user_id = ? ORDER BY updated_at DESC`
      )
      .all(uid(req));
    res.json({ success: true, data: rows });
  })
);

router.post(
  '/templates',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid template', 400, 'VALIDATION_ERROR');
    const t = parsed.data;
    const id = nanoid();
    getDatabase()
      .prepare(
        `INSERT INTO session_templates
           (id, user_id, name, cli_provider, cli_model, cli_reasoning, mode,
            working_directory, design_style_skill, writing_style_skill, surface)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        uid(req),
        t.name,
        t.cliProvider ?? null,
        t.cliModel ?? null,
        t.cliReasoning ?? null,
        t.mode ?? null,
        t.workingDirectory ?? null,
        t.designStyleSkill ?? null,
        t.writingStyleSkill ?? null,
        t.surface ?? 'code'
      );
    const row = getDatabase()
      .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM session_templates WHERE id = ?`)
      .get(id);
    res.json({ success: true, data: row });
  })
);

router.delete(
  '/templates/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = getDatabase()
      .prepare('DELETE FROM session_templates WHERE id = ? AND user_id = ?')
      .run(req.params.id, uid(req));
    if (result.changes === 0) throw new AppError('Template not found', 404, 'NOT_FOUND');
    res.json({ success: true });
  })
);

// ===========================================================================
// Notification centre
// ===========================================================================

router.get(
  '/notifications',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT id, session_id as sessionId, kind, title, body, data,
                read_at as readAt, created_at as createdAt
         FROM notifications WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(uid(req), limit) as Array<Record<string, unknown> & { data: string | null }>;
    // `data` is stored as JSON text; clients want the object, and a corrupt row
    // should not poison the whole feed.
    const items = rows.map(({ data, ...rest }) => ({
      ...rest,
      data: data ? safeJson(data) : null,
    }));
    const unread = db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(uid(req)) as { c: number };
    res.json({ success: true, data: { items, unreadCount: unread.c } });
  })
);

router.post(
  '/notifications/read',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : null;
    const db = getDatabase();
    if (ids && ids.length > 0) {
      const marks = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND read_at IS NULL AND id IN (${marks})`
      ).run(uid(req), ...ids);
    } else {
      // No ids means "mark everything read" — the usual bell-menu action.
      db.prepare(
        'UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL'
      ).run(uid(req));
    }
    res.json({ success: true });
  })
);

router.delete(
  '/notifications',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    getDatabase().prepare('DELETE FROM notifications WHERE user_id = ?').run(uid(req));
    res.json({ success: true });
  })
);

/**
 * Fires one sample notification down the whole chain — database, socket and
 * web push. Without it there is no way to tell a silent alert threshold from a
 * broken delivery path except by burning real budget.
 */
router.post(
  '/notifications/test',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { notify } = await import('../services/notifications/notificationCenter.js');
    notify({
      userId: uid(req),
      kind: 'usage_alert',
      title: 'Test alert',
      body: 'If you can see this, notifications and push delivery both work.',
    });
    res.json({ success: true });
  })
);

// ===========================================================================
// Web push subscriptions
// ===========================================================================

const subscriptionSchema = z.object({
  endpoint: z.string().trim().url().max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(512),
    auth: z.string().trim().min(1).max(512),
  }),
});

router.get(
  '/push/public-key',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    // Absent keys are a valid state: the UI then simply does not offer push.
    res.json({ success: true, data: { publicKey: process.env.VAPID_PUBLIC_KEY || null } });
  })
);

router.post(
  '/push/subscribe',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid subscription', 400, 'VALIDATION_ERROR');
    const { endpoint, keys } = parsed.data;
    getDatabase()
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth`
      )
      .run(nanoid(), uid(req), endpoint, keys.p256dh, keys.auth, req.get('user-agent') || null);
    res.json({ success: true });
  })
);

router.post(
  '/push/unsubscribe',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) throw new AppError('Missing endpoint', 400, 'VALIDATION_ERROR');
    getDatabase()
      .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(uid(req), endpoint);
    res.json({ success: true });
  })
);

// ===========================================================================
// Cross-device composer drafts
// ===========================================================================

function assertOwnedSession(sessionId: string, userId: string): void {
  const owned = getDatabase()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!owned) throw new AppError('Session not found', 404, 'NOT_FOUND');
}

router.get(
  '/sessions/:id/draft',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    assertOwnedSession(req.params.id as string, uid(req));
    const chatId = String(req.query.chatId || '');
    const row = getDatabase()
      .prepare(
        `SELECT content, updated_at as updatedAt FROM session_drafts
         WHERE session_id = ? AND user_id = ? AND chat_id = ?`
      )
      .get(req.params.id, uid(req), chatId) as
      | { content: string; updatedAt: string }
      | undefined;
    res.json({ success: true, data: row ?? { content: '', updatedAt: null } });
  })
);

router.put(
  '/sessions/:id/draft',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    assertOwnedSession(req.params.id as string, uid(req));
    const content = String(req.body?.content ?? '').slice(0, 100_000);
    const chatId = String(req.body?.chatId ?? '');
    const db = getDatabase();
    if (!content.trim()) {
      db.prepare(
        'DELETE FROM session_drafts WHERE session_id = ? AND user_id = ? AND chat_id = ?'
      ).run(req.params.id, uid(req), chatId);
    } else {
      db.prepare(
        `INSERT INTO session_drafts (session_id, user_id, chat_id, content, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id, user_id, chat_id) DO UPDATE SET
           content = excluded.content, updated_at = CURRENT_TIMESTAMP`
      ).run(req.params.id, uid(req), chatId, content);
    }
    res.json({ success: true });
  })
);

// ===========================================================================
// Turn diffs
// ===========================================================================

router.get(
  '/sessions/:id/turn-diffs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    assertOwnedSession(req.params.id as string, uid(req));
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = getDatabase()
      .prepare(
        `SELECT id, turn_id as turnId, files_changed as filesChanged,
                insertions, deletions, summary, created_at as createdAt
         FROM turn_diffs WHERE session_id = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(req.params.id, uid(req), limit);
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/turn-diffs/:diffId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const row = getDatabase()
      .prepare(
        `SELECT id, session_id as sessionId, turn_id as turnId,
                files_changed as filesChanged, insertions, deletions,
                summary, diff, created_at as createdAt
         FROM turn_diffs WHERE id = ? AND user_id = ?`
      )
      .get(req.params.diffId, uid(req));
    if (!row) throw new AppError('Diff not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: row });
  })
);

export default router;
