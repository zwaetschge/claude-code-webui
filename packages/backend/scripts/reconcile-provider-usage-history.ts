import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { estimateModelCost } from '@plum-code-webui/shared';

type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };
type RecoveredTurn = Tokens & {
  sessionId: string;
  userId: string;
  provider: 'claude' | 'zai' | 'opencode';
  turnId: string;
  model: string;
  createdAt: string;
  completedAt: string;
};

// Shapes of the third-party transcript records this script reads. Only the
// fields the reconciliation actually consumes are declared; everything else in
// the JSONL/SQLite payloads is intentionally ignored.
type ClaudeTranscriptEvent = {
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  uuid?: string;
  sourceToolAssistantUUID?: string;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
};

type OpenCodeMessageData = {
  role?: string;
  providerID?: string;
  modelID?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

const apply = process.argv.includes('--apply');
const sinceArg = process.argv.find((arg) => arg.startsWith('--since='))?.slice('--since='.length);
const since = new Date(sinceArg || '2026-06-22T00:00:00Z');
if (!Number.isFinite(since.getTime())) throw new Error(`Invalid --since value: ${sinceArg}`);

const root = path.resolve(import.meta.dirname, '../../..');
const webDbPath = process.env.WEBUI_DB_PATH || path.join(root, 'data/claude-webui.db');
const claudeProjects = process.env.CLAUDE_PROJECTS_DIR || '/home/node/.claude/projects';
const openCodeDbPath = process.env.OPENCODE_DB_PATH || '/home/node/.opencode/share/opencode.db';
const web = new Database(webDbPath);

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (target: Tokens, value: Tokens) => {
  target.input += value.input;
  target.output += value.output;
  target.cacheRead += value.cacheRead;
  target.cacheWrite += value.cacheWrite;
};
const total = (tokens: Tokens) =>
  tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
const sqlTimestamp = (value: string | number) =>
  new Date(value).toISOString().replace('T', ' ').replace('Z', '');
const projectKey = (directory: string) => directory.replace(/[^a-zA-Z0-9]/g, '-');

function activeClaudeSourceIds(): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync('/proc')) return ids;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ');
      const match = command.match(/(?:--resume|--session-id)\s+([0-9a-f-]{36})/i);
      if (match?.[1]) ids.add(match[1]);
    } catch {
      // Processes can disappear while /proc is scanned.
    }
  }
  return ids;
}

const sessions = web
  .prepare('SELECT id, user_id, working_directory, created_at FROM sessions')
  .all() as Array<{
  id: string;
  user_id: string;
  working_directory: string;
  created_at: string;
}>;

function chooseSession(directory: string, timestamp: number) {
  const candidates = sessions.filter((session) => session.working_directory === directory);
  return (
    candidates
      .filter((session) => Date.parse(`${session.created_at}Z`) <= timestamp)
      .sort((a, b) => Date.parse(`${b.created_at}Z`) - Date.parse(`${a.created_at}Z`))[0] ||
    candidates[0]
  );
}

function recoverClaude(): RecoveredTurn[] {
  if (!fs.existsSync(claudeProjects)) return [];
  const byProject = new Map(
    sessions.map((session) => [projectKey(session.working_directory), session])
  );
  const turns: RecoveredTurn[] = [];
  const activeSources = activeClaudeSourceIds();

  for (const projectEntry of fs.readdirSync(claudeProjects, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;
    const webSession = byProject.get(projectEntry.name);
    if (!webSession) continue;
    const projectDir = path.join(claudeProjects, projectEntry.name);

    for (const filename of fs.readdirSync(projectDir).filter((name) => name.endsWith('.jsonl'))) {
      const sourceId = path.basename(filename, '.jsonl');
      if (activeSources.has(sourceId)) continue;
      const seenResponses = new Set<string>();
      let current: RecoveredTurn | null = null;
      const modelCounts = new Map<string, number>();

      const finish = () => {
        if (!current || total(current) === 0) return;
        current.model =
          [...modelCounts.entries()]
            .filter(([model]) => model && model !== '<synthetic>')
            .sort((a, b) => b[1] - a[1])[0]?.[0] ||
          current.model ||
          'unknown';
        if (
          current.model.toLowerCase().startsWith('glm-') ||
          current.model.toLowerCase().startsWith('z-ai/glm-') ||
          current.model.toLowerCase().startsWith('zai/glm-')
        ) {
          current.provider = 'zai';
        }
        turns.push(current);
      };

      for (const line of fs.readFileSync(path.join(projectDir, filename), 'utf8').split('\n')) {
        if (!line) continue;
        let event: ClaudeTranscriptEvent;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const timestamp = Date.parse(event.timestamp || '');
        if (!Number.isFinite(timestamp) || timestamp < since.getTime()) continue;

        if (event.type === 'user' && !event.isMeta) {
          const content = event.message?.content;
          const blocks = Array.isArray(content) ? content : [];
          const toolResult =
            Boolean(event.sourceToolAssistantUUID) ||
            (blocks.length > 0 &&
              blocks.every((block: { type?: string } | null) => block?.type === 'tool_result'));
          if (!toolResult) {
            finish();
            modelCounts.clear();
            current = {
              ...zero(),
              sessionId: webSession.id,
              userId: webSession.user_id,
              provider: 'claude',
              turnId: `recovered:claude:${sourceId}:${event.uuid || timestamp}`,
              model: 'unknown',
              createdAt: sqlTimestamp(timestamp),
              completedAt: sqlTimestamp(timestamp),
            };
          }
          continue;
        }

        const message = event.message;
        if (event.type !== 'assistant' || !message?.usage || !message.id || !current) continue;
        if (seenResponses.has(message.id)) continue;
        seenResponses.add(message.id);
        const usage = message.usage;
        add(current, {
          input: Number(usage.input_tokens) || 0,
          output: Number(usage.output_tokens) || 0,
          cacheRead: Number(usage.cache_read_input_tokens) || 0,
          cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
        });
        current.completedAt = sqlTimestamp(timestamp);
        const model = typeof message.model === 'string' ? message.model : 'unknown';
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      }
      finish();
    }
  }
  return turns;
}

function recoverOpenCode(): RecoveredTurn[] {
  if (!fs.existsSync(openCodeDbPath)) return [];
  const source = new Database(openCodeDbPath, { readonly: true });
  const sourceSessions = source
    .prepare(
      'SELECT id, parent_id, directory, time_created FROM session WHERE time_created >= ? ORDER BY time_created'
    )
    .all(since.getTime()) as Array<{
    id: string;
    parent_id: string | null;
    directory: string;
    time_created: number;
  }>;
  const children = new Map<string, typeof sourceSessions>();
  for (const session of sourceSessions) {
    if (!session.parent_id) continue;
    const list = children.get(session.parent_id) || [];
    list.push(session);
    children.set(session.parent_id, list);
  }
  const descendants = (rootId: string): typeof sourceSessions => {
    const result: typeof sourceSessions = [];
    const queue = [...(children.get(rootId) || [])];
    while (queue.length) {
      const child = queue.shift()!;
      result.push(child);
      queue.push(...(children.get(child.id) || []));
    }
    return result;
  };
  const readMessages = source.prepare(
    'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id'
  );
  const turns: RecoveredTurn[] = [];

  for (const rootSession of sourceSessions.filter((session) => !session.parent_id)) {
    const webSession = chooseSession(rootSession.directory, rootSession.time_created);
    if (!webSession) continue;
    const rootMessages = readMessages.all(rootSession.id) as Array<{
      id: string;
      time_created: number;
      data: string;
    }>;
    const rootTurns: Array<RecoveredTurn & { endAt: number; models: Map<string, number> }> = [];
    let current: (typeof rootTurns)[number] | null = null;
    for (const row of rootMessages) {
      let data: OpenCodeMessageData;
      try {
        data = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (data.role === 'user') {
        if (current) current.endAt = row.time_created;
        current = {
          ...zero(),
          sessionId: webSession.id,
          userId: webSession.user_id,
          provider: 'opencode',
          turnId: `recovered:opencode:${rootSession.id}:${row.id}`,
          model: 'unknown',
          createdAt: sqlTimestamp(row.time_created),
          completedAt: sqlTimestamp(row.time_created),
          endAt: Number.POSITIVE_INFINITY,
          models: new Map(),
        };
        rootTurns.push(current);
      } else if (data.role === 'assistant' && current) {
        const tokens = data.tokens || {};
        add(current, {
          input: Number(tokens.input) || 0,
          output: (Number(tokens.output) || 0) + (Number(tokens.reasoning) || 0),
          cacheRead: Number(tokens.cache?.read) || 0,
          cacheWrite: Number(tokens.cache?.write) || 0,
        });
        current.completedAt = sqlTimestamp(row.time_created);
        const model = `${data.providerID || ''}/${data.modelID || ''}`.replace(/^\//, '');
        current.models.set(model, (current.models.get(model) || 0) + 1);
      }
    }

    for (const child of descendants(rootSession.id)) {
      const target =
        [...rootTurns]
          .reverse()
          .find(
            (turn) =>
              Date.parse(`${turn.createdAt}Z`) <= child.time_created &&
              child.time_created < turn.endAt
          ) || rootTurns.at(-1);
      if (!target) continue;
      for (const row of readMessages.all(child.id) as Array<{
        data: string;
        time_created: number;
      }>) {
        let data: OpenCodeMessageData;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }
        if (data.role !== 'assistant') continue;
        const tokens = data.tokens || {};
        add(target, {
          input: Number(tokens.input) || 0,
          output: (Number(tokens.output) || 0) + (Number(tokens.reasoning) || 0),
          cacheRead: Number(tokens.cache?.read) || 0,
          cacheWrite: Number(tokens.cache?.write) || 0,
        });
        target.completedAt = sqlTimestamp(row.time_created);
        const model = `${data.providerID || ''}/${data.modelID || ''}`.replace(/^\//, '');
        target.models.set(model, (target.models.get(model) || 0) + 1);
      }
    }

    for (const turn of rootTurns) {
      if (!total(turn)) continue;
      turn.model = [...turn.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
      turns.push(turn);
    }
  }
  source.close();
  return turns;
}

const recovered = [...recoverClaude(), ...recoverOpenCode()];
const summary = new Map<string, { turns: number; tokens: Tokens; cost: number }>();
for (const turn of recovered) {
  const key = `${turn.provider}:${turn.model}`;
  const item = summary.get(key) || { turns: 0, tokens: zero(), cost: 0 };
  item.turns += 1;
  add(item.tokens, turn);
  item.cost += estimateModelCost(
    turn.model,
    {
      inputTokens: turn.input,
      outputTokens: turn.output,
      cacheReadTokens: turn.cacheRead,
      cacheCreationTokens: turn.cacheWrite,
    },
    null
  ).cost;
  summary.set(key, item);
}

console.log(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      since: since.toISOString(),
      recovered: [...summary.entries()].map(([key, value]) => ({
        key,
        turns: value.turns,
        ...value.tokens,
        total: total(value.tokens),
        costUsd: value.cost,
      })),
    },
    null,
    2
  )
);

if (apply && recovered.length) {
  const backupDir = path.join(path.dirname(webDbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `claude-webui-before-provider-usage-reconcile-${new Date().toISOString().replace(/[:]/g, '-')}.db`
  );
  await web.backup(backupPath);

  const ranges = new Map<string, { provider: string; min: string; max: string }>();
  for (const turn of recovered) {
    const key = `${turn.provider}:${turn.sessionId}`;
    const range = ranges.get(key);
    if (!range)
      ranges.set(key, { provider: turn.provider, min: turn.createdAt, max: turn.completedAt });
    else {
      if (turn.createdAt < range.min) range.min = turn.createdAt;
      if (turn.completedAt > range.max) range.max = turn.completedAt;
    }
  }

  const remove = web.prepare(
    'DELETE FROM usage_history WHERE provider = ? AND session_id = ? AND created_at >= ? AND created_at <= ?'
  );
  const removeOpenCodeWindow = web.prepare(
    "DELETE FROM usage_history WHERE provider = 'opencode' AND created_at >= ?"
  );
  const insert = web.prepare(`
    INSERT INTO usage_history (
      user_id, session_id, provider, turn_id, input_tokens, output_tokens,
      cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  web.transaction(() => {
    removeOpenCodeWindow.run(sqlTimestamp(since.getTime()));
    for (const [key, range] of ranges) {
      if (range.provider === 'opencode') continue;
      const sessionId = key.slice(key.indexOf(':') + 1);
      remove.run(range.provider, sessionId, range.min, range.max);
    }
    for (const turn of recovered) {
      const cost = estimateModelCost(
        turn.model,
        {
          inputTokens: turn.input,
          outputTokens: turn.output,
          cacheReadTokens: turn.cacheRead,
          cacheCreationTokens: turn.cacheWrite,
        },
        null
      ).cost;
      insert.run(
        turn.userId,
        turn.sessionId,
        turn.provider,
        turn.turnId,
        turn.input,
        turn.output,
        turn.cacheRead,
        turn.cacheWrite,
        total(turn),
        cost,
        turn.model,
        turn.createdAt
      );
    }
  })();
  console.log(JSON.stringify({ applied: recovered.length, backupPath }, null, 2));
}

web.close();
