import { Router } from 'express';
import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError } from '../middleware/errorHandler';
import type { McpServer, McpServerType } from '@claude-code-webui/shared';

const router = Router();

const createMcpServerSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['subprocess', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateMcpServerSchema = createMcpServerSchema.partial();

// Helper to parse MCP server from DB
function parseMcpServer(row: Record<string, unknown>): McpServer {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    type: row.type as McpServerType,
    command: row.command as string | null,
    args: row.args ? JSON.parse(row.args as string) : [],
    url: row.url as string | null,
    env: row.env ? JSON.parse(row.env as string) : {},
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as string,
  };
}

// List MCP servers
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const rows = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE user_id = ? ORDER BY name`
    )
    .all(userId) as Record<string, unknown>[];

  const servers = rows.map(parseMcpServer);

  res.json({ success: true, data: servers });
});

// Get MCP server by ID
router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: parseMcpServer(row) });
});

// Create MCP server
router.post('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  // Validate type-specific fields
  if (type === 'subprocess' && !command) {
    throw new AppError('Command is required for subprocess type', 400, 'MISSING_COMMAND');
  }
  if (type === 'sse' && !url) {
    throw new AppError('URL is required for SSE type', 400, 'MISSING_URL');
  }

  const db = getDatabase();
  const serverId = nanoid();

  db.prepare(
    `INSERT INTO mcp_servers (id, user_id, name, type, command, args, url, env, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    serverId,
    userId,
    name,
    type,
    command || null,
    args ? JSON.stringify(args) : null,
    url || null,
    env ? JSON.stringify(env) : null,
    enabled !== false ? 1 : 0
  );

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`
    )
    .get(serverId) as Record<string, unknown>;

  res.status(201).json({ success: true, data: parseMcpServer(row) });
});

// Update MCP server
router.put('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!existing) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (type !== undefined) {
    updates.push('type = ?');
    values.push(type);
  }
  if (command !== undefined) {
    updates.push('command = ?');
    values.push(command);
  }
  if (args !== undefined) {
    updates.push('args = ?');
    values.push(JSON.stringify(args));
  }
  if (url !== undefined) {
    updates.push('url = ?');
    values.push(url);
  }
  if (env !== undefined) {
    updates.push('env = ?');
    values.push(JSON.stringify(env));
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ success: true, data: parseMcpServer(row) });
});

// Delete MCP server
router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM mcp_servers WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);

  if (result.changes === 0) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Test MCP server connection
router.post('/:id/test', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  const server = parseMcpServer(row);

  try {
    if (server.type === 'subprocess') {
      // Test subprocess by trying to spawn and checking if it starts
      const result = await testSubprocessMcp(server.command!, server.args || []);
      res.json({ success: true, data: result });
    } else if (server.type === 'sse') {
      // Test SSE by trying to connect to the URL
      const result = await testSseMcp(server.url!);
      res.json({ success: true, data: result });
    } else {
      throw new AppError('Unknown server type', 400, 'UNKNOWN_TYPE');
    }
  } catch (error) {
    res.json({
      success: true,
      data: {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Helper to test subprocess MCP server
async function testSubprocessMcp(
  command: string,
  args: string[]
): Promise<{ connected: boolean; error?: string; output?: string }> {
  return new Promise((resolve) => {
    // Parse command - might be "npx something" or just "something"
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    if (!cmd) {
      resolve({ connected: false, error: 'Invalid command' });
      return;
    }
    const cmdArgs = [...parts.slice(1), ...args];

    const proc = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ connected: false, error: 'Connection timeout (5s)' });
    }, 5000);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      // If we get any output, the server started successfully
      clearTimeout(timeout);
      proc.kill();
      resolve({ connected: true, output: stdout.substring(0, 200) });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeout);
      resolve({ connected: false, error: `Failed to start: ${err.message}` });
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0 && !stdout) {
        resolve({
          connected: false,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    // Send a basic MCP initialize request to check if it responds
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    proc.stdin?.write(initRequest + '\n');
  });
}

// Helper to test SSE MCP server
async function testSseMcp(
  url: string
): Promise<{ connected: boolean; error?: string; status?: number }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { connected: true, status: response.status };
    } else {
      return {
        connected: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { connected: false, error: 'Connection timeout (5s)' };
    }
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default router;
