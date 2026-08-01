/**
 * Recover Codex spend that never reached usage_history.
 *
 * Three historical leaks left turns unbooked (all fixed in ClaudeProcessManager,
 * but the past rows are still missing):
 *   1. subagent threads were charged against a null thread id and dropped
 *   2. an exec killed mid-turn emitted no turn.completed, so nothing was saved
 *   3. turn.failed carries no usage payload
 *
 * Codex still has the ground truth in ~/.codex: the thread graph in
 * state_<n>.sqlite plus one rollout per thread. This script walks every exec
 * root, computes the tree's real spend, subtracts whatever usage_history
 * already booked in that thread's lifetime, and inserts the remainder.
 *
 * Replay caveat: Codex copies the parent conversation into each spawned
 * thread and the child's counter continues from the parent's value at fork
 * time. readCodexDescendantUsageDetail strips that replayed prefix — summing
 * raw rollout totals instead would multiply the parent's tokens by its number
 * of children.
 *
 * Usage:
 *   tsx scripts/backfill-codex-usage-history.ts [--since=2026-07-01] [--apply]
 *
 * Dry-run by default; --apply writes. Turn ids are derived from the thread id,
 * so re-running is idempotent.
 */
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { estimateModelCost } from '@plum-code-webui/shared';
import {
  readCodexDescendantUsageDetail,
  readCodexThreadCumulativeUsage,
} from '../src/services/claude/ClaudeProcessManager.js';

const apply = process.argv.includes('--apply');
const sinceArg = process.argv.find((arg) => arg.startsWith('--since='))?.slice('--since='.length);
const since = new Date(sinceArg || '2026-07-01T00:00:00Z');
if (!Number.isFinite(since.getTime())) throw new Error(`Invalid --since value: ${sinceArg}`);

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const root = path.resolve(import.meta.dirname, '../../..');
const webDbPath =
  process.env.WEBUI_DB_PATH || path.join(root, 'packages/backend/data/claude-webui.db');

function findCodexStateDb(home: string): string | null {
  try {
    return (
      fsSync
        .readdirSync(home, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
        .map((entry) => {
          const filePath = path.join(home, entry.name);
          return { filePath, mtimeMs: fsSync.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null
    );
  } catch {
    return null;
  }
}

const statePath = findCodexStateDb(codexHome);
if (!statePath) throw new Error(`No Codex state database found in ${codexHome}`);
if (!fsSync.existsSync(webDbPath)) throw new Error(`WebUI database not found at ${webDbPath}`);

const state = new Database(statePath, { readonly: true });
const web = new Database(webDbPath, { readonly: !apply });

interface ThreadRow {
  id: string;
  source: string | null;
  cwd: string;
  model: string | null;
  createdAtMs: number | null;
  createdAt: number | null;
  updatedAtMs: number | null;
  updatedAt: number | null;
}

const threads = state
  .prepare(
    `SELECT id, source, cwd, model,
            created_at_ms as createdAtMs, created_at as createdAt,
            updated_at_ms as updatedAtMs, updated_at as updatedAt
       FROM threads`
  )
  .all() as ThreadRow[];

const msOf = (ms: number | null, seconds: number | null) =>
  Number(ms) || (Number(seconds) > 0 ? Number(seconds) * 1000 : 0);

function isExecRoot(row: ThreadRow): boolean {
  if (!row.source?.startsWith('{')) return true;
  try {
    const parsed = JSON.parse(row.source) as Record<string, unknown>;
    const subagent = parsed.subagent as Record<string, unknown> | undefined;
    const spawn = subagent?.thread_spawn as Record<string, unknown> | undefined;
    return typeof spawn?.parent_thread_id !== 'string' || !spawn.parent_thread_id;
  } catch {
    return true;
  }
}

const sessions = web
  .prepare(
    `SELECT id, user_id as userId, working_directory as workingDirectory,
            created_at as createdAt, updated_at as updatedAt
       FROM sessions`
  )
  .all() as Array<{
  id: string;
  userId: string;
  workingDirectory: string | null;
  createdAt: string;
  updatedAt: string;
}>;

const sessionsByCwd = new Map<string, typeof sessions>();
for (const session of sessions) {
  const cwd = session.workingDirectory?.trim();
  if (!cwd) continue;
  sessionsByCwd.set(cwd, [...(sessionsByCwd.get(cwd) || []), session]);
}

/**
 * Attribute a Codex thread to a WebUI session by working directory. When a
 * directory has been used by several sessions, prefer the one whose recorded
 * activity actually brackets the thread's lifetime.
 */
function resolveSession(cwd: string, startedMs: number) {
  const candidates = sessionsByCwd.get(cwd);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const bracketing = candidates.filter((session) => {
    const created = Date.parse(`${session.createdAt.replace(' ', 'T')}Z`);
    const updated = Date.parse(`${session.updatedAt.replace(' ', 'T')}Z`);
    return (
      Number.isFinite(created) &&
      created <= startedMs &&
      (!Number.isFinite(updated) || updated >= startedMs)
    );
  });
  const pool = bracketing.length > 0 ? bracketing : candidates;
  return pool.reduce((best, session) =>
    Date.parse(session.updatedAt) > Date.parse(best.updatedAt) ? session : best
  );
}

const sqlTimestamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const bookedInRange = web.prepare(
  `SELECT COALESCE(SUM(total_tokens), 0) as tokens
     FROM usage_history
    WHERE session_id = ? AND provider = 'codex'
      AND created_at >= ? AND created_at <= ?`
);

const insertTurn = web.prepare(
  `INSERT INTO usage_history (
     user_id, session_id, provider, turn_id, input_tokens, output_tokens,
     cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model, created_at
   ) VALUES (?, ?, 'codex', ?, ?, ?, ?, 0, ?, ?, ?, ?)
   ON CONFLICT(session_id, provider, turn_id) DO NOTHING`
);

// The breakdown table ships with the backend migrations, but the backfill may
// run against a database whose backend has not started since the upgrade.
if (apply) {
  web.exec(`
    CREATE TABLE IF NOT EXISTS usage_subagent_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      parent_agent_id TEXT,
      agent_type TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_subagent_turn_agent
      ON usage_subagent_turns(session_id, provider, turn_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_usage_subagent_user_created
      ON usage_subagent_turns(user_id, created_at DESC);
  `);
}

const insertSubagent = apply
  ? web.prepare(
      `INSERT INTO usage_subagent_turns (
     user_id, session_id, provider, turn_id, agent_id, parent_agent_id, agent_type, model,
     input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
     total_tokens, cost_usd, created_at
   ) VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
   ON CONFLICT(session_id, provider, turn_id, agent_id) DO NOTHING`
    )
  : null;

// A thread that is still being written to will keep booking turns through the
// live manager. Backfilling it now would double-count once it finishes.
const activeCutoffMs = Date.now() - 60 * 60 * 1000;

let scanned = 0;
let skippedStillActive = 0;
let recovered = 0;
let recoveredTokens = 0;
let skippedNoSession = 0;
let skippedAlreadyBooked = 0;
const rows: Array<Record<string, string | number>> = [];

for (const thread of threads) {
  if (!isExecRoot(thread)) continue;
  const startedMs = msOf(thread.createdAtMs, thread.createdAt);
  if (!startedMs || startedMs < since.getTime()) continue;
  scanned += 1;

  const lastActivityMs = Math.max(msOf(thread.updatedAtMs, thread.updatedAt), startedMs);
  if (lastActivityMs > activeCutoffMs) {
    skippedStillActive += 1;
    continue;
  }

  const own = readCodexThreadCumulativeUsage(codexHome, thread.id);
  const descendants = readCodexDescendantUsageDetail(codexHome, thread.id);
  const treeInput = (own?.input ?? 0) + descendants.reduce((sum, d) => sum + d.usage.input, 0);
  const treeCached = (own?.cached ?? 0) + descendants.reduce((sum, d) => sum + d.usage.cached, 0);
  const treeOutput = (own?.output ?? 0) + descendants.reduce((sum, d) => sum + d.usage.output, 0);
  const treeTotal = treeInput + treeOutput;
  if (treeTotal <= 0) continue;

  const session = resolveSession(thread.cwd, startedMs);
  if (!session) {
    skippedNoSession += 1;
    continue;
  }

  const endedMs = lastActivityMs + 60_000;
  const booked = (
    bookedInRange.get(session.id, sqlTimestamp(startedMs - 60_000), sqlTimestamp(endedMs)) as {
      tokens: number;
    }
  ).tokens;

  const missingTotal = treeTotal - booked;
  // 1% slack: a booked row and the rollout meter can differ by a few reasoning
  // tokens without anything actually being missing.
  if (missingTotal <= treeTotal * 0.01) {
    skippedAlreadyBooked += 1;
    continue;
  }

  // Scale the split by the recovered share so the row keeps the tree's
  // input/cached/output proportions instead of inventing a shape.
  const share = missingTotal / treeTotal;
  const cached = Math.round(treeCached * share);
  const nonCachedInput = Math.max(Math.round(treeInput * share) - cached, 0);
  const output = Math.max(missingTotal - nonCachedInput - cached, 0);
  const model = thread.model || 'gpt-5.6-sol';
  const cost = estimateModelCost(
    model,
    {
      inputTokens: nonCachedInput,
      outputTokens: output,
      cacheReadTokens: cached,
      cacheCreationTokens: 0,
    },
    null
  ).cost;

  const turnId = `codex-backfill-${thread.id}`;
  const createdAt = sqlTimestamp(lastActivityMs);

  rows.push({
    thread: thread.id.slice(0, 8),
    session: session.id,
    tree: treeTotal,
    booked,
    recovered: missingTotal,
    subagents: descendants.length,
    at: createdAt,
  });
  recovered += 1;
  recoveredTokens += missingTotal;

  if (!apply) continue;

  insertTurn.run(
    session.userId,
    session.id,
    turnId,
    nonCachedInput,
    output,
    cached,
    missingTotal,
    cost,
    model,
    createdAt
  );

  for (const descendant of descendants) {
    if (descendant.usage.input <= 0 && descendant.usage.output <= 0) continue;
    const subCached = descendant.usage.cached;
    const subInput = Math.max(descendant.usage.input - subCached, 0);
    const subModel = descendant.model || model;
    insertSubagent?.run(
      session.userId,
      session.id,
      turnId,
      descendant.threadId,
      descendant.parentThreadId,
      descendant.agentType,
      subModel,
      subInput,
      descendant.usage.output,
      subCached,
      subInput + descendant.usage.output + subCached,
      estimateModelCost(
        subModel,
        {
          inputTokens: subInput,
          outputTokens: descendant.usage.output,
          cacheReadTokens: subCached,
          cacheCreationTokens: 0,
        },
        null
      ).cost,
      createdAt
    );
  }
}

console.table(rows);
console.log(
  [
    `mode:                ${apply ? 'APPLY' : 'dry-run (pass --apply to write)'}`,
    `since:               ${since.toISOString()}`,
    `exec roots scanned:  ${scanned}`,
    `still active (skip):  ${skippedStillActive}`,
    `already booked:      ${skippedAlreadyBooked}`,
    `no matching session: ${skippedNoSession}`,
    `turns recovered:     ${recovered}`,
    `tokens recovered:    ${recoveredTokens.toLocaleString()}`,
  ].join('\n')
);

state.close();
web.close();
