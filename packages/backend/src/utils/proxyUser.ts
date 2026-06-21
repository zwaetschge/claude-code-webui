import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
import type { User } from '@plum-code-webui/shared';
import { getDatabase } from '../db';

const USER_SELECT = `
  id,
  email,
  name,
  avatar_url as avatarUrl,
  provider,
  provider_id as providerId,
  role,
  status,
  strftime('%Y-%m-%dT%H:%M:%fZ', last_login_at) as lastLoginAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
`;

function ensureUserSettings(db: Database.Database, userId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
  ).run(userId);
}

function promoteFirstUserIfNeeded(db: Database.Database, userId: string): void {
  const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`).get() as {
    count: number;
  };
  if (row.count === 0) {
    db.prepare(`UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      userId
    );
  }
}

export function upsertProxyUserInDatabase(
  db: Database.Database,
  email: string,
  name?: string | null,
  username?: string | null
): User {
  const normalizedEmail = email.trim().toLowerCase();
  const fallbackName = normalizedEmail.split('@')[0] || normalizedEmail;
  const displayName = name?.trim() || username?.trim() || fallbackName;
  const providerId = normalizedEmail;

  const existingProxyUser = db
    .prepare(`SELECT ${USER_SELECT} FROM users WHERE provider = 'proxy' AND provider_id = ?`)
    .get(providerId) as User | undefined;

  if (existingProxyUser) {
    db.prepare(
      `UPDATE users
       SET email = ?, name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(normalizedEmail, displayName, existingProxyUser.id);
    ensureUserSettings(db, existingProxyUser.id);
    return {
      ...existingProxyUser,
      email: normalizedEmail,
      name: displayName,
    };
  }

  const existingEmailUser = db
    .prepare(`SELECT ${USER_SELECT} FROM users WHERE LOWER(email) = LOWER(?)`)
    .get(normalizedEmail) as User | undefined;

  if (existingEmailUser) {
    db.prepare(
      `UPDATE users
       SET name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(displayName, existingEmailUser.id);
    ensureUserSettings(db, existingEmailUser.id);
    promoteFirstUserIfNeeded(db, existingEmailUser.id);
    return {
      ...existingEmailUser,
      name: displayName || existingEmailUser.name,
    };
  }

  const legacySharedCliUser = db
    .prepare(
      `SELECT ${USER_SELECT} FROM users WHERE provider = 'cli' AND provider_id = 'local-cli'`
    )
    .get() as User | undefined;

  if (legacySharedCliUser) {
    db.prepare(
      `UPDATE users
       SET email = ?, name = ?, provider = 'proxy', provider_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(normalizedEmail, displayName, providerId, legacySharedCliUser.id);
    ensureUserSettings(db, legacySharedCliUser.id);
    promoteFirstUserIfNeeded(db, legacySharedCliUser.id);
    return {
      ...legacySharedCliUser,
      email: normalizedEmail,
      name: displayName,
      provider: 'proxy',
      providerId,
    };
  }

  const userId = nanoid();
  db.prepare(
    `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
     VALUES (?, ?, ?, NULL, 'proxy', ?)`
  ).run(userId, normalizedEmail, displayName, providerId);
  ensureUserSettings(db, userId);
  promoteFirstUserIfNeeded(db, userId);

  const createdUser = db.prepare(`SELECT ${USER_SELECT} FROM users WHERE id = ?`).get(userId) as
    | User
    | undefined;

  if (!createdUser) {
    throw new Error('Proxy user was not created');
  }

  return createdUser;
}

export function upsertProxyUser(
  email: string,
  name?: string | null,
  username?: string | null
): User {
  return upsertProxyUserInDatabase(getDatabase(), email, name, username);
}
