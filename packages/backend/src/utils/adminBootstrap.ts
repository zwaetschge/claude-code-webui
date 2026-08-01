import type Database from 'better-sqlite3';
import { config } from '../config.js';

export function getBootstrapAdminEmail(): string | null {
  return process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || config.auth.allowedEmails[0] || null;
}

/** Promote only the configured bootstrap identity (or the first user when no
 * identity was configured) and only while the instance has no administrator. */
export function ensureBootstrapAdmin(
  db: Database.Database,
  userId: string,
  email: string
): boolean {
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (admin) return false;

  const preferredEmail = getBootstrapAdminEmail();
  if (preferredEmail && preferredEmail !== email.trim().toLowerCase()) return false;

  const result = db
    .prepare(`UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(userId);
  return result.changes > 0;
}
