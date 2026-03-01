import { nanoid } from 'nanoid';
import type { User } from '@claude-code-webui/shared';
import { getDatabase } from '../db';

const CLI_LOCAL_PROVIDERS = ['cli', 'claude', 'codex', 'zai', 'gemini'] as const;
const CLI_LOCAL_PROVIDER_ID = 'local-cli';

export function upsertSharedCliUser(email: string, name: string): User {
  const db = getDatabase();

  const existingUsers = db.prepare(
    `SELECT * FROM users WHERE provider_id = ? AND provider IN (${CLI_LOCAL_PROVIDERS.map(() => '?').join(',')})`
  ).all(CLI_LOCAL_PROVIDER_ID, ...CLI_LOCAL_PROVIDERS) as User[];

  let user = existingUsers.find((candidate) => candidate.provider === 'cli') || existingUsers[0];

  if (!user) {
    const userId = nanoid();
    db.prepare(
      `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
       VALUES (?, ?, ?, ?, 'cli', ?)`
    ).run(userId, email, name, null, CLI_LOCAL_PROVIDER_ID);

    db.prepare(
      `INSERT INTO user_settings (user_id, theme, allowed_tools)
       VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
    ).run(userId);

    user = {
      id: userId,
      email,
      name,
      avatarUrl: null,
      provider: 'cli',
      providerId: CLI_LOCAL_PROVIDER_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as User;
  } else {
    db.prepare('UPDATE users SET email = ?, name = ?, provider = ? WHERE id = ?')
      .run(email, name, 'cli', user.id);
    user.email = email;
    user.name = name;
    user.provider = 'cli';
  }

  const otherUsers = existingUsers.filter((candidate) => candidate.id !== user?.id);
  for (const other of otherUsers) {
    db.prepare('UPDATE sessions SET user_id = ? WHERE user_id = ?').run(user.id, other.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(other.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(other.id);
  }

  return user;
}
