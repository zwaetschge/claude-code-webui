import type Database from 'better-sqlite3';
import session, { type SessionData } from 'express-session';

import { getDatabase } from '../db/index.js';

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function expirationFor(data: SessionData): number {
  const expires = data.cookie?.expires;
  if (expires) {
    const timestamp = new Date(expires).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const maxAge = data.cookie?.maxAge;
  return Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_MAX_AGE_MS);
}

/** SQLite-backed express-session store with bounded, opportunistic cleanup. */
export class SqliteSessionStore extends session.Store {
  private readonly database: Database.Database;
  private lastPrune = 0;

  constructor(database: Database.Database = getDatabase()) {
    super();
    this.database = database;
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      const row = this.database
        .prepare('SELECT data, expires_at FROM http_sessions WHERE sid = ?')
        .get(sid) as { data: string; expires_at: number } | undefined;

      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.database.prepare('DELETE FROM http_sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }

      try {
        callback(null, JSON.parse(row.data) as SessionData);
      } catch {
        this.database.prepare('DELETE FROM http_sessions WHERE sid = ?').run(sid);
        callback(null, null);
      }
    } catch (error) {
      callback(error);
    }
  }

  set(sid: string, data: SessionData, callback?: (err?: unknown) => void): void {
    try {
      this.pruneExpired();
      this.database
        .prepare(
          `INSERT INTO http_sessions (sid, data, expires_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(sid) DO UPDATE SET
             data = excluded.data,
             expires_at = excluded.expires_at,
             updated_at = CURRENT_TIMESTAMP`
        )
        .run(sid, JSON.stringify(data), expirationFor(data));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.database.prepare('DELETE FROM http_sessions WHERE sid = ?').run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid: string, data: SessionData, callback?: (err?: unknown) => void): void {
    try {
      this.pruneExpired();
      this.database
        .prepare(
          `UPDATE http_sessions
           SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE sid = ?`
        )
        .run(expirationFor(data), sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_INTERVAL_MS) return;
    this.database.prepare('DELETE FROM http_sessions WHERE expires_at <= ?').run(now);
    this.lastPrune = now;
  }
}

/** Revoke every Passport browser session owned by a user. */
export function revokeUserHttpSessions(
  userId: string,
  database: Database.Database = getDatabase()
): number {
  return database
    .prepare(
      `DELETE FROM http_sessions
       WHERE json_valid(data)
         AND json_extract(data, '$.passport.user') = ?`
    )
    .run(userId).changes;
}
