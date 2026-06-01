/**
 * Codex CLI config bootstrap.
 *
 * Idempotently ensures `~/.codex/config.toml` has:
 *   1. Sane WebUI defaults (model, reasoning, sandbox).
 *   2. Two [profiles.*] presets (fast / deep) for the UI's profile selector.
 *   3. MCP servers ported from Claude's settings.json so Codex sessions get
 *      the same `generate_image`, `android_*`, etc. tools that Claude sessions
 *      have. Claude format `{type, command, args, env}` →
 *      Codex TOML `[mcp_servers.<name>] command/args + .env block`.
 *
 * Runs once at backend startup. Existing keys are preserved unless the
 * `[webui-managed]` block markers are present, in which case the managed block
 * is replaced atomically.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { safeJsonParse } from './json';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from './codexDefaults';

const MANAGED_BLOCK_START = '# >>> webui-managed defaults >>>';
const MANAGED_BLOCK_END = '# <<< webui-managed defaults <<<';

interface ClaudeMcpServer {
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tomlArray(values: string[]): string {
  return `[${values.map((v) => `"${escapeTomlString(v)}"`).join(', ')}]`;
}

function renderMcpServers(servers: Record<string, ClaudeMcpServer>): string {
  const blocks: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const lines: string[] = [`[mcp_servers.${name}]`];

    if (server.url) {
      // HTTP transport
      lines.push(`url = "${escapeTomlString(server.url)}"`);
      if (server.headers) {
        const headerEntries = Object.entries(server.headers)
          .map(([k, v]) => `"${escapeTomlString(k)}" = "${escapeTomlString(v)}"`)
          .join(', ');
        lines.push(`http_headers = { ${headerEntries} }`);
      }
    } else if (server.command) {
      // stdio transport (default)
      lines.push(`command = "${escapeTomlString(server.command)}"`);
      if (server.args && server.args.length > 0) {
        lines.push(`args = ${tomlArray(server.args)}`);
      }
    } else {
      continue; // Skip malformed
    }

    blocks.push(lines.join('\n'));

    if (server.env && Object.keys(server.env).length > 0) {
      const envLines = [`[mcp_servers.${name}.env]`];
      for (const [key, value] of Object.entries(server.env)) {
        envLines.push(`${key} = "${escapeTomlString(value)}"`);
      }
      blocks.push(envLines.join('\n'));
    }
  }
  return blocks.join('\n\n');
}

function buildManagedBlock(claudeSettings: ClaudeSettings | null): string {
  const approvalPolicy = getCodexWebuiApprovalPolicy();
  const sandboxMode = getCodexWebuiSandboxMode();
  const sections: string[] = [
    MANAGED_BLOCK_START,
    '# Managed by claude-code-webui — do not edit by hand inside this block.',
    '# Custom config outside the markers is preserved across rewrites.',
    '',
    '# WebUI defaults',
    'model = "gpt-5.5"',
    'model_reasoning_effort = "medium"',
    `approval_policy = "${approvalPolicy}"`,
    `sandbox_mode = "${sandboxMode}"`,
    'plan_mode_reasoning_effort = "high"',
    '',
    '# Profile presets exposed in the WebUI UI ("/codex profile fast" etc.)',
    '[profiles.fast]',
    'model = "gpt-5.4-mini"',
    'model_reasoning_effort = "low"',
    '',
    '[profiles.balanced]',
    'model = "gpt-5.5"',
    'model_reasoning_effort = "medium"',
    '',
    '[profiles.deep]',
    'model = "gpt-5.5"',
    'model_reasoning_effort = "xhigh"',
  ];

  if (claudeSettings?.mcpServers && Object.keys(claudeSettings.mcpServers).length > 0) {
    sections.push('', '# MCP servers (mirrored from ~/.claude/settings.json)');
    sections.push(renderMcpServers(claudeSettings.mcpServers));
  }

  sections.push('', MANAGED_BLOCK_END);
  return sections.join('\n');
}

function spliceManagedBlock(existing: string, newBlock: string): string {
  const startIdx = existing.indexOf(MANAGED_BLOCK_START);
  const endIdx = existing.indexOf(MANAGED_BLOCK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No managed block yet — append (with leading separator if file isn't empty)
    const sep = existing.trim() ? '\n\n' : '';
    return `${existing.trimEnd()}${sep}${newBlock}\n`;
  }
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + MANAGED_BLOCK_END.length);
  return `${before.trimEnd()}\n${newBlock}\n${after.trimStart()}`;
}

/**
 * Ensure `~/.codex/config.toml` exists and contains our managed defaults + MCP mirror.
 * Returns a short status string for logs.
 */
export async function syncCodexConfig(
  opts: { codexHome?: string; claudeSettingsPath?: string } = {}
): Promise<string> {
  const codexHome = opts.codexHome || path.join(os.homedir(), '.codex');
  const configPath = path.join(codexHome, 'config.toml');
  const claudeSettingsPath =
    opts.claudeSettingsPath || path.join(os.homedir(), '.claude', 'settings.json');

  let claudeSettings: ClaudeSettings | null = null;
  try {
    const raw = await fs.readFile(claudeSettingsPath, 'utf-8');
    claudeSettings = safeJsonParse<ClaudeSettings>(raw, {} as ClaudeSettings);
  } catch {
    // No Claude settings — that's fine, just skip the MCP mirror
  }

  const managedBlock = buildManagedBlock(claudeSettings);

  await fs.mkdir(codexHome, { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(configPath, 'utf-8');
  } catch {
    // First run — file doesn't exist
  }

  const updated = spliceManagedBlock(existing, managedBlock);

  // Skip write if nothing changed (idempotent across restarts)
  if (existing === updated) {
    return `codex config.toml unchanged at ${configPath}`;
  }

  await fs.writeFile(configPath, updated, 'utf-8');
  const mcpCount = claudeSettings?.mcpServers ? Object.keys(claudeSettings.mcpServers).length : 0;
  return `codex config.toml updated at ${configPath} (${mcpCount} MCP servers mirrored)`;
}
