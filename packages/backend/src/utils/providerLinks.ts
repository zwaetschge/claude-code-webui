import fs from 'fs';
import os from 'os';
import path from 'path';

// Claude Code tool names (PascalCase) → OpenCode tool names (lowercase).
// OpenCode only whitelists this set; unlisted Claude tools (WebSearch,
// AskUserQuestion, ...) are dropped silently or the agent fails to load.
const TOOL_MAP: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  Bash: 'bash',
  WebFetch: 'webfetch',
  TodoWrite: 'todowrite',
  Task: 'task',
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface Parsed {
  fields: Record<string, string>;
  body: string;
}

function parseFrontmatter(source: string): Parsed | null {
  const m = source.match(FRONTMATTER_RE);
  if (!m) return null;
  const raw = m[1] ?? '';
  const body = m[2] ?? '';
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, body };
}

// Claude agents declare `tools: Read, Write, Edit` (CSV string). OpenCode
// expects a YAML record (`tools:\n  read: true\n  write: true`). Convert and
// filter to OpenCode's whitelist.
function toOpencodeAgent(claudeSource: string): string | null {
  const parsed = parseFrontmatter(claudeSource);
  if (!parsed) return null;

  const { fields, body } = parsed;
  const toolsRaw = fields.tools ?? '';
  const allowed: string[] = [];
  for (const raw of toolsRaw.split(',')) {
    const mapped = TOOL_MAP[raw.trim()];
    if (mapped) allowed.push(mapped);
  }

  // Claude agents keep the description in the body's first paragraph, but
  // OpenCode requires it in frontmatter. Lift the first non-empty line up.
  const description =
    fields.description ||
    body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#')) ||
    fields.name ||
    '';

  const lines: string[] = ['---'];
  if (fields.name) lines.push(`name: ${fields.name}`);
  lines.push(`description: ${description.replace(/"/g, '\\"')}`);
  lines.push('mode: subagent');
  if (allowed.length > 0) {
    lines.push('tools:');
    for (const tool of allowed) lines.push(`  ${tool}: true`);
  }
  lines.push('---');
  lines.push('');
  lines.push(body.trimStart());

  return lines.join('\n');
}

// Claude subagents live at ~/.claude/agents/<name>.md. OpenCode reads
// ~/.config/opencode/agents (→ ~/.opencode/config/agents via the Dockerfile
// symlink) and validates strictly, so a plain dir symlink crashes OpenCode on
// every session. Convert each agent to OpenCode's schema on backend startup.
// Skills are not touched — OpenCode scans ~/.claude/skills natively.
export function syncOpencodeAgents(): void {
  const home = os.homedir();
  const srcDir = path.join(home, '.claude/agents');
  const dstDir = path.join(home, '.opencode/config/agents');

  if (!fs.existsSync(srcDir)) return;

  // If the dst is a stale symlink from an earlier build, drop it so we can
  // write real files in its place.
  try {
    const st = fs.lstatSync(dstDir);
    if (st.isSymbolicLink()) fs.unlinkSync(dstDir);
  } catch {
    // doesn't exist
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  let converted = 0;
  let skipped = 0;

  for (const file of entries) {
    try {
      const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const output = toOpencodeAgent(source);
      if (!output) {
        skipped += 1;
        continue;
      }
      fs.writeFileSync(path.join(dstDir, file), output);
      converted += 1;
    } catch (err) {
      console.error(`[init] Failed to convert agent ${file}:`, err);
      skipped += 1;
    }
  }

  // Prune dst files whose source no longer exists.
  const srcNames = new Set(entries);
  for (const existing of fs.readdirSync(dstDir)) {
    if (existing.endsWith('.md') && !srcNames.has(existing)) {
      try {
        fs.unlinkSync(path.join(dstDir, existing));
      } catch {
        /* ignore */
      }
    }
  }

  console.log(`[init] OpenCode agents synced: ${converted} converted, ${skipped} skipped`);
}
