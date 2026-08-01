import type { Request } from 'express';
import { getDatabase } from '../db/index.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append to the audit log. Failures are logged but never thrown — an audit write must
 * never break the caller's request. Treat this as best-effort telemetry.
 */
export function recordAudit(entry: AuditEntry): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO audit_log (actor_user_id, action, resource_type, resource_id, ip, user_agent, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.actorUserId,
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );
  } catch (err) {
    console.error('[audit] write failed:', err, entry);
  }
}

/** Extract actor + request context from an Express request. */
export function auditFromRequest(
  req: Request,
  action: string,
  extras: Partial<Omit<AuditEntry, 'action' | 'ip' | 'userAgent'>> = {}
): void {
  const actorUserId = (req as Request & { userId?: string }).userId ?? null;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;
  recordAudit({
    actorUserId,
    action,
    ip,
    userAgent,
    ...extras,
  });
}

/**
 * Stamp a successful login: bump last_login_at and audit the event. Used by every
 * auth code path (OAuth callbacks, basic-auth, dev-login, CLI bootstrap) so we have
 * a single place to reason about login accounting.
 */
export function stampLogin(
  userId: string,
  method: string,
  req?: Request,
  metadata: Record<string, unknown> = {}
): void {
  try {
    const db = getDatabase();
    db.prepare(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(userId);
  } catch (err) {
    console.error('[audit] last_login_at update failed:', err);
  }
  const ip = req
    ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null
    : null;
  const userAgent = req ? ((req.headers['user-agent'] as string | undefined) ?? null) : null;
  recordAudit({
    actorUserId: userId,
    action: 'auth.login.success',
    ip,
    userAgent,
    metadata: { method, ...metadata },
  });
}
