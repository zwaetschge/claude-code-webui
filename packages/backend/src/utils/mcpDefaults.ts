import fs from 'fs/promises';
import os from 'os';
import path from 'path';

interface ClaudeMcpServer {
  type?: 'stdio' | 'http' | 'sse' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
  [key: string]: unknown;
}

export const WEBUI_DEFAULT_MCP_SERVERS: Record<string, ClaudeMcpServer> = {
  godot: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/godot.mjs'],
  },
  blender: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/blender.mjs'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getDefaultClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export async function ensureDefaultClaudeMcpServers(
  opts: { settingsPath?: string; servers?: Record<string, ClaudeMcpServer> } = {}
): Promise<{ updated: boolean; added: string[]; settingsPath: string }> {
  const settingsPath = opts.settingsPath || getDefaultClaudeSettingsPath();
  const defaults = opts.servers || WEBUI_DEFAULT_MCP_SERVERS;
  let settings: ClaudeSettings = {};

  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error('settings.json root must be an object');
    }
    settings = parsed as ClaudeSettings;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  if (!isRecord(settings.mcpServers)) {
    settings.mcpServers = {};
  }

  const added: string[] = [];
  for (const [name, server] of Object.entries(defaults)) {
    if (settings.mcpServers[name]) continue;
    settings.mcpServers[name] = server;
    added.push(name);
  }

  if (added.length === 0) {
    return { updated: false, added, settingsPath };
  }

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { updated: true, added, settingsPath };
}
