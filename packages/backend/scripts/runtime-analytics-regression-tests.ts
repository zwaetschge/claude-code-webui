import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  insertUsageHistoryTurn,
  migrateUsageHistoryAttribution,
  reconcileStaleRunningSessions,
} from '../src/db/index.js';
import {
  getProviderLabelForUsage,
  getUsageModelKey,
} from '../../shared/src/types/cli-providers.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    cli_provider TEXT DEFAULT 'codex',
    status TEXT DEFAULT 'stopped',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO users (id) VALUES ('user-1');
  INSERT INTO sessions (id, user_id, cli_provider, status)
  VALUES
    ('pi-session', 'user-1', 'pi', 'running'),
    ('opencode-session', 'user-1', 'opencode', 'running'),
    ('stopped-session', 'user-1', 'codex', 'stopped');

  INSERT INTO usage_history (user_id, session_id, total_tokens, model)
  VALUES
    ('user-1', 'pi-session', 10, 'z-ai/glm-5.1'),
    ('user-1', 'opencode-session', 20, 'z-ai/glm-5.1');
`);

assert.equal(migrateUsageHistoryAttribution(db), 2);
assert.deepEqual(
  db.prepare('SELECT session_id, provider FROM usage_history ORDER BY session_id').all(),
  [
    { session_id: 'opencode-session', provider: 'opencode' },
    { session_id: 'pi-session', provider: 'pi' },
  ],
  'historical routed-model rows should use Pi/OpenCode session attribution when available'
);

const usageColumns = new Set(
  (db.prepare('PRAGMA table_info(usage_history)').all() as Array<{ name: string }>).map(
    ({ name }) => name
  )
);
assert.ok(usageColumns.has('provider'));
assert.ok(usageColumns.has('turn_id'));
assert.equal(migrateUsageHistoryAttribution(db), 0, 'the ledger migration should be repeatable');

const turn = {
  userId: 'user-1',
  sessionId: 'pi-session',
  provider: 'pi' as const,
  turnId: 'message-1',
  inputTokens: 100,
  outputTokens: 25,
  cacheReadTokens: 50,
  cacheCreationTokens: 0,
  totalTokens: 175,
  costUsd: 0.001,
  model: 'z-ai/glm-5.1',
  createdAt: '2026-07-26T21:46:47.000Z',
};
assert.equal(insertUsageHistoryTurn(db, turn), true);
assert.equal(insertUsageHistoryTurn(db, turn), false, 'the same completed turn must be idempotent');
assert.equal(
  (
    db
      .prepare(
        `SELECT created_at as createdAt
         FROM usage_history
         WHERE session_id = 'pi-session' AND provider = 'pi' AND turn_id = 'message-1'`
      )
      .get() as { createdAt: string }
  ).createdAt,
  '2026-07-26 21:46:47',
  'usage should be attributed to user turn submission time rather than completion time'
);
assert.equal(
  (
    db
      .prepare(
        `SELECT COUNT(*) as count
       FROM usage_history
       WHERE session_id = 'pi-session' AND provider = 'pi' AND turn_id = 'message-1'`
      )
      .get() as { count: number }
  ).count,
  1
);

const providerGroups = db
  .prepare(
    `SELECT provider, model, SUM(total_tokens) as tokens
     FROM usage_history
     WHERE model = 'z-ai/glm-5.1'
     GROUP BY provider, model
     ORDER BY provider`
  )
  .all() as Array<{ provider: string; model: string; tokens: number }>;
assert.equal(providerGroups.length, 2, 'one shared model id must remain split by runtime provider');
assert.equal(getProviderLabelForUsage('pi', 'z-ai/glm-5.1'), 'Pi');
assert.equal(getProviderLabelForUsage('opencode', 'z-ai/glm-5.1'), 'OpenCode');
assert.notEqual(
  getUsageModelKey('pi', 'z-ai/glm-5.1'),
  getUsageModelKey('opencode', 'z-ai/glm-5.1'),
  'timeline model series must not collide across harnesses'
);

assert.equal(reconcileStaleRunningSessions(db), 2);
assert.deepEqual(db.prepare('SELECT id, status FROM sessions ORDER BY id').all(), [
  { id: 'opencode-session', status: 'stopped' },
  { id: 'pi-session', status: 'stopped' },
  { id: 'stopped-session', status: 'stopped' },
]);
assert.equal(reconcileStaleRunningSessions(db), 0, 'startup reconciliation should be repeatable');

db.close();
console.log('runtime analytics regression tests passed');
