import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDatabase } from '../../db/index.js';

/**
 * Credentials for an external supervisor.
 *
 * The point of the gateway is that another instance — Hermes, an OpenCode or
 * Codex CLI, a cron script — can watch and drive every session through exactly
 * the API the user drives. So a gateway token resolves to a user identity and
 * then flows through the normal auth path; there is no parallel, weaker set of
 * endpoints to keep in sync.
 */

export const GATEWAY_TOKEN_PREFIX = 'plum_gw_';

export interface GatewayTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createGatewayToken(
  userId: string,
  name: string
): { token: string; row: GatewayTokenRow } {
  const secret = randomBytes(32).toString('base64url');
  const token = `${GATEWAY_TOKEN_PREFIX}${secret}`;
  const id = nanoid();
  // Enough to recognise a token in a list without being enough to use it.
  const tokenPrefix = token.slice(0, GATEWAY_TOKEN_PREFIX.length + 6);

  getDatabase()
    .prepare(
      `INSERT INTO gateway_tokens (id, user_id, name, token_hash, token_prefix)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, userId, name.trim() || 'gateway', hashToken(token), tokenPrefix);

  return {
    token,
    row: {
      id,
      name: name.trim() || 'gateway',
      tokenPrefix,
      revoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export function listGatewayTokens(userId: string): GatewayTokenRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, token_prefix AS tokenPrefix, revoked,
              last_used_at AS lastUsedAt, created_at AS createdAt
         FROM gateway_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId) as Array<Omit<GatewayTokenRow, 'revoked'> & { revoked: number }>;
  return rows.map((row) => ({ ...row, revoked: row.revoked === 1 }));
}

export function revokeGatewayToken(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare('UPDATE gateway_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}

/**
 * Resolve a presented token to its owner, or null. Constant-time compare on the
 * stored hash: the lookup is by hash anyway, but a plain string equality here
 * would leak timing on the hash itself.
 */
export function resolveGatewayToken(token: string): string | null {
  if (!token.startsWith(GATEWAY_TOKEN_PREFIX)) return null;

  const presented = hashToken(token);
  const row = getDatabase()
    .prepare(
      'SELECT id, user_id AS userId, token_hash AS tokenHash FROM gateway_tokens WHERE token_hash = ? AND revoked = 0'
    )
    .get(presented) as { id: string; userId: string; tokenHash: string } | undefined;
  if (!row) return null;

  const a = Buffer.from(row.tokenHash, 'hex');
  const b = Buffer.from(presented, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Best effort — a failed bookkeeping write must not fail the request.
  try {
    getDatabase()
      .prepare('UPDATE gateway_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(row.id);
  } catch {
    /* ignore */
  }

  return row.userId;
}
