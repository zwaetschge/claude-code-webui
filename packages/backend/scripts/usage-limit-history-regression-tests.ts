import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  normalizeUsageLimitHistoryRange,
  queryUsageLimitHistory,
  recordUsageLimitSnapshots,
} from '../src/services/usage-limit-history.js';

const database = new Database(':memory:');
database.exec(`
  CREATE TABLE usage_limit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    metric_label TEXT NOT NULL,
    utilization REAL,
    used_value REAL,
    limit_value REAL,
    remaining_value REAL,
    unit TEXT,
    resets_at TEXT,
    window_seconds INTEGER,
    source TEXT,
    reset_detected INTEGER NOT NULL DEFAULT 0,
    reset_event_at TEXT,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_usage_limit_snapshots_series_recorded
    ON usage_limit_snapshots(user_id, provider, metric_key, recorded_at DESC);
  CREATE TABLE usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT,
    provider TEXT NOT NULL DEFAULT 'unknown',
    turn_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const userId = 'quota-user';
const initialAt = new Date('2026-07-28T10:00:00.000Z');
const firstResetAt = '2026-07-28T11:00:00.000Z';

database
  .prepare(
    `INSERT INTO usage_history (
      user_id, session_id, input_tokens, output_tokens, cache_read_tokens,
      cache_creation_tokens, total_tokens, provider, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  .run(userId, 'session-1', 600, 200, 100, 0, 900, 'zai', '2026-07-28 10:04:00');
database
  .prepare(
    `INSERT INTO usage_history (
      user_id, session_id, input_tokens, output_tokens, cache_read_tokens,
      cache_creation_tokens, total_tokens, provider, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  .run(userId, 'session-1', 100, 50, 25, 0, 175, 'z-ai', '2026-07-28 10:11:00');
database
  .prepare(
    `INSERT INTO usage_history (
      user_id, session_id, total_tokens, provider, created_at
    ) VALUES (?, ?, ?, ?, ?)`
  )
  .run('other-user', 'session-2', 99_999, 'zai', '2026-07-28 10:07:00');

const initialCount = recordUsageLimitSnapshots(
  database,
  userId,
  'zai',
  {
    fiveHour: {
      utilization: 80,
      used: 800,
      limit: 1000,
      remaining: 200,
      unit: 'tokens',
      resetsAt: firstResetAt,
      windowSeconds: 18_000,
    },
    sevenDay: null,
    sevenDaySonnet: null,
    additional: [
      {
        name: 'Web search',
        utilization: 25,
        used: 250,
        limit: 1000,
        remaining: 750,
        unit: 'requests',
        resetsAt: '2026-08-04T10:00:00.000Z',
      },
    ],
    accountUsage: {
      periodDays: 30,
      totalTokens: 2_900_000,
      totalRequests: 120,
    },
    source: 'upstream',
  },
  initialAt
);
assert.equal(initialCount, 4, 'five-hour, web-search, account tokens, and account calls persist');

const duplicateCount = recordUsageLimitSnapshots(
  database,
  userId,
  'zai',
  {
    fiveHour: {
      utilization: 80,
      used: 800,
      limit: 1000,
      remaining: 200,
      unit: 'tokens',
      resetsAt: firstResetAt,
      windowSeconds: 18_000,
    },
    sevenDay: null,
    sevenDaySonnet: null,
    source: 'upstream',
  },
  new Date('2026-07-28T10:01:00.000Z')
);
assert.equal(duplicateCount, 0, 'rapid identical refreshes are deduplicated');

const resetCount = recordUsageLimitSnapshots(
  database,
  userId,
  'zai',
  {
    fiveHour: {
      utilization: 4,
      used: 40,
      limit: 1000,
      remaining: 960,
      unit: 'tokens',
      resetsAt: '2026-07-28T16:00:00.000Z',
      windowSeconds: 18_000,
    },
    sevenDay: null,
    sevenDaySonnet: null,
    source: 'upstream',
  },
  new Date('2026-07-28T11:01:00.000Z')
);
assert.equal(resetCount, 1);

const history = queryUsageLimitHistory(
  database,
  userId,
  ['zai'],
  '24h',
  new Date('2026-07-28T11:05:00.000Z')
);
const fiveHour = history.points.filter((point) => point.metricKey === 'five_hour');
assert.equal(fiveHour.length, 2);
assert.equal(fiveHour[0]?.used, 800);
assert.equal(fiveHour[1]?.used, 40);
assert.equal(fiveHour[1]?.resetDetected, true);
assert.equal(fiveHour[1]?.resetEventAt, firstResetAt);
assert.equal(history.sampledEverySeconds, 900);
assert.equal(
  history.points.some((point) => point.metricKey === 'account_30d_tokens'),
  true,
  'absolute account-token history is available'
);
assert.deepEqual(history.trackedTokens, [
  {
    provider: 'zai',
    inputTokens: 700,
    outputTokens: 250,
    cacheReadTokens: 125,
    cacheCreationTokens: 0,
    totalTokens: 1075,
    recordedAt: '2026-07-28T10:00:00.000Z',
  },
]);

const otherUserHistory = queryUsageLimitHistory(
  database,
  'other-user',
  ['zai'],
  '24h',
  new Date('2026-07-28T11:05:00.000Z')
);
assert.equal(otherUserHistory.points.length, 0, 'quota history is user-isolated');
assert.equal(otherUserHistory.trackedTokens.length, 1, 'local token history is user-isolated');
assert.equal(otherUserHistory.trackedTokens[0]?.totalTokens, 99_999);
assert.equal(normalizeUsageLimitHistoryRange('30d'), '30d');
assert.equal(normalizeUsageLimitHistoryRange('invalid'), '24h');

database.close();
console.log('usage limit history regression tests passed');
