import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { rateLimiters } from '../middleware/rateLimiter';
import { getDatabase } from '../db';
import { safeJsonParse } from '../utils/json';
import { recordAudit } from '../utils/auditLog';
import { getProcessManager } from '../websocket';
import type { SessionRuntimeSnapshot } from '../services/claude/ClaudeProcessManager';

const router = Router();

const AUTOMATION_TOKEN_PREFIX = 'plum_';
const automationScopeValues = [
  'sessions:read',
  'sessions:message',
  'sessions:control',
  'goals:read',
  'goals:write',
] as const;
type AutomationScope = (typeof automationScopeValues)[number];

const defaultAutomationScopes: AutomationScope[] = [
  'sessions:read',
  'sessions:message',
  'goals:read',
  'goals:write',
];
const allAutomationScopes = new Set<AutomationScope>(automationScopeValues);

const goalStatusValues = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
type GoalStatus = (typeof goalStatusValues)[number];
const allGoalStatuses = new Set<GoalStatus>(goalStatusValues);

interface AutomationPrincipal {
  type: 'user' | 'automation_token';
  userId: string;
  tokenId: string | null;
  scopes: AutomationScope[];
}

type AutomationRequest = Request & {
  automationPrincipal: AutomationPrincipal;
  userId: string;
};

interface AutomationTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopesJson: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  status: string;
  lastMessage: string | null;
  starred: number;
  category: string | null;
  cliProvider: string;
  mode: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivity: string;
  messageCount: number;
  openGoalCount: number;
}

interface GoalRow {
  id: string;
  sessionId: string;
  title: string;
  instructions: string | null;
  status: GoalStatus;
  priority: number;
  metadataJson: string | null;
  createdByUserId: string | null;
  createdByTokenId: string | null;
  createdAt: string;
  updatedAt: string;
  sessionName?: string;
  workingDirectory?: string;
}

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(automationScopeValues)).min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const statusQuerySchema = z.object({
  recentMessages: z.coerce.number().int().min(0).max(50).default(10),
});

const listGoalsQuerySchema = z.object({
  status: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const createGoalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(10_000).optional(),
  status: z.enum(goalStatusValues).optional().default('pending'),
  priority: z.number().int().min(-100).max(100).optional().default(0),
  metadata: z.record(z.unknown()).optional(),
});

const updateGoalSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(10_000).nullable().optional(),
  status: z.enum(goalStatusValues).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(50_000),
  goalId: z.string().min(1).max(80).optional(),
});

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createTokenValue(): string {
  return `${AUTOMATION_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function getRequestContext(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip || req.socket.remoteAddress || null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

function parseScopes(scopesJson: string): AutomationScope[] {
  return safeJsonParse<string[]>(scopesJson, []).filter((scope): scope is AutomationScope =>
    allAutomationScopes.has(scope as AutomationScope)
  );
}

function assertScopes(principal: AutomationPrincipal, requiredScopes: AutomationScope[]): void {
  const granted = new Set(principal.scopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new AppError(`Automation token missing scope: ${missing.join(', ')}`, 403, 'FORBIDDEN');
  }
}

function setPrincipal(req: Request, principal: AutomationPrincipal): void {
  (req as AutomationRequest).automationPrincipal = principal;
  (req as AuthenticatedRequest).userId = principal.userId;
}

function authenticateAutomationToken(token: string): AutomationPrincipal {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT t.id, t.user_id as userId, t.scopes_json as scopesJson,
              strftime('%Y-%m-%dT%H:%M:%fZ', t.expires_at) as expiresAt,
              u.status as userStatus
       FROM automation_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`
    )
    .get(tokenHash(token)) as
    | {
        id: string;
        userId: string;
        scopesJson: string;
        expiresAt: string | null;
        userStatus: string;
      }
    | undefined;

  if (!row) {
    throw new AppError('Invalid automation token', 401, 'INVALID_TOKEN');
  }
  if (row.userStatus === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) {
    throw new AppError('Automation token expired', 401, 'TOKEN_EXPIRED');
  }

  db.prepare('UPDATE automation_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    row.id
  );

  return {
    type: 'automation_token',
    userId: row.userId,
    tokenId: row.id,
    scopes: parseScopes(row.scopesJson),
  };
}

function requireAutomation(requiredScopes: AutomationScope[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const bearer = getBearerToken(req);
      if (bearer?.startsWith(AUTOMATION_TOKEN_PREFIX)) {
        const principal = authenticateAutomationToken(bearer);
        assertScopes(principal, requiredScopes);
        setPrincipal(req, principal);
        return next();
      }

      return requireAuth(req, res, () => {
        const userId = (req as AuthenticatedRequest).userId;
        setPrincipal(req, {
          type: 'user',
          userId,
          tokenId: null,
          scopes: [...automationScopeValues],
        });
        next();
      });
    } catch (err) {
      return next(err);
    }
  };
}

function currentPrincipal(req: Request): AutomationPrincipal {
  return (req as AutomationRequest).automationPrincipal;
}

function formatToken(row: AutomationTokenRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: parseScopes(row.scopesJson),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatGoal(row: GoalRow): Record<string, unknown> {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    workingDirectory: row.workingDirectory,
    title: row.title,
    instructions: row.instructions,
    status: row.status,
    priority: row.priority,
    metadata: safeJsonParse<Record<string, unknown> | null>(row.metadataJson, null),
    createdByUserId: row.createdByUserId,
    createdByTokenId: row.createdByTokenId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function runtimeFor(sessionId: string): SessionRuntimeSnapshot {
  return getProcessManager().getSessionRuntimeSnapshot(sessionId);
}

function formatSession(row: SessionRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    workingDirectory: row.workingDirectory,
    claudeSessionId: row.claudeSessionId,
    status: row.status,
    lastMessage: row.lastMessage,
    starred: Boolean(row.starred),
    category: row.category,
    cliProvider: row.cliProvider,
    mode: row.mode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivity: row.lastActivity,
    messageCount: row.messageCount,
    openGoalCount: row.openGoalCount,
    runtime: runtimeFor(row.id),
  };
}

function getOwnedSession(sessionId: string, userId: string): SessionRow {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
              s.starred, s.category, s.cli_provider as cliProvider, s.mode,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(
                (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id),
                s.updated_at
              )) as lastActivity,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as messageCount,
              (SELECT COUNT(*) FROM session_goals g
               WHERE g.session_id = s.id AND g.status IN ('pending', 'in_progress', 'blocked')) as openGoalCount
       FROM sessions s
       WHERE s.id = ? AND s.user_id = ?`
    )
    .get(sessionId, userId) as SessionRow | undefined;

  if (!row) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }
  return row;
}

function listSessionGoals(sessionId: string): Record<string, unknown>[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, session_id as sessionId, title, instructions, status, priority,
              metadata_json as metadataJson, created_by_user_id as createdByUserId,
              created_by_token_id as createdByTokenId,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM session_goals
       WHERE session_id = ?
       ORDER BY
         CASE status
           WHEN 'in_progress' THEN 0
           WHEN 'blocked' THEN 1
           WHEN 'pending' THEN 2
           ELSE 3
         END,
         priority DESC,
         created_at DESC`
    )
    .all(sessionId) as GoalRow[];
  return rows.map(formatGoal);
}

function getRecentMessages(sessionId: string, limit: number): Array<Record<string, unknown>> {
  if (limit === 0) return [];
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, session_id as sessionId, role, content,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
       FROM messages
       WHERE session_id = ?
       ORDER BY rowid DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as Array<Record<string, unknown>>;
  return rows.reverse();
}

function parseGoalStatusFilter(raw: string | undefined): GoalStatus[] | null {
  if (!raw || raw === 'all') return null;
  const statuses = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (statuses.length === 0) return null;
  for (const status of statuses) {
    if (!allGoalStatuses.has(status as GoalStatus)) {
      throw new AppError(`Invalid goal status: ${status}`, 400, 'VALIDATION_ERROR');
    }
  }
  return statuses as GoalStatus[];
}

function assertGoalOwnership(goalId: string, userId: string): GoalRow {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT g.id, g.session_id as sessionId, g.title, g.instructions, g.status, g.priority,
              g.metadata_json as metadataJson, g.created_by_user_id as createdByUserId,
              g.created_by_token_id as createdByTokenId,
              strftime('%Y-%m-%dT%H:%M:%fZ', g.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', g.updated_at) as updatedAt,
              s.name as sessionName, s.working_directory as workingDirectory
       FROM session_goals g
       JOIN sessions s ON s.id = g.session_id
       WHERE g.id = ? AND s.user_id = ?`
    )
    .get(goalId, userId) as GoalRow | undefined;
  if (!row) {
    throw new AppError('Goal not found', 404, 'NOT_FOUND');
  }
  return row;
}

router.get('/tokens', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, user_id as userId, name, token_prefix as tokenPrefix, scopes_json as scopesJson,
              strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) as expiresAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', revoked_at) as revokedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', last_used_at) as lastUsedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM automation_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(userId) as AutomationTokenRow[];

  res.json({ success: true, data: rows.map(formatToken) });
});

router.post('/tokens', requireAuth, rateLimiters.strict, (req, res) => {
  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid token payload', 400, 'VALIDATION_ERROR');
  }

  const userId = (req as AuthenticatedRequest).userId;
  const token = createTokenValue();
  const id = nanoid();
  const scopes = parsed.data.scopes ?? defaultAutomationScopes;
  const expiresAt = parsed.data.expiresAt ?? null;

  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new AppError('expiresAt must be in the future', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  db.prepare(
    `INSERT INTO automation_tokens
      (id, user_id, name, token_hash, token_prefix, scopes_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    parsed.data.name,
    tokenHash(token),
    token.slice(0, 16),
    JSON.stringify(scopes),
    expiresAt
  );

  const context = getRequestContext(req);
  recordAudit({
    actorUserId: userId,
    action: 'automation.token.created',
    resourceType: 'automation_token',
    resourceId: id,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: { name: parsed.data.name, scopes },
  });

  const row = db
    .prepare(
      `SELECT id, user_id as userId, name, token_prefix as tokenPrefix, scopes_json as scopesJson,
              strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) as expiresAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', revoked_at) as revokedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', last_used_at) as lastUsedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM automation_tokens
       WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as AutomationTokenRow;

  res.status(201).json({ success: true, data: { token, tokenInfo: formatToken(row) } });
});

router.delete('/tokens/:id', requireAuth, (req, res) => {
  const tokenId = req.params.id;
  if (!tokenId) {
    throw new AppError('Token id required', 400, 'VALIDATION_ERROR');
  }
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE automation_tokens
       SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .run(tokenId, userId);
  if (result.changes === 0) {
    throw new AppError('Token not found', 404, 'NOT_FOUND');
  }

  const context = getRequestContext(req);
  recordAudit({
    actorUserId: userId,
    action: 'automation.token.revoked',
    resourceType: 'automation_token',
    resourceId: tokenId,
    ip: context.ip,
    userAgent: context.userAgent,
  });

  res.json({ success: true });
});

router.get('/sessions', requireAutomation(['sessions:read']), rateLimiters.standard, (req, res) => {
  const principal = currentPrincipal(req);
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
              s.starred, s.category, s.cli_provider as cliProvider, s.mode,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(
                (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id),
                s.updated_at
              )) as lastActivity,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as messageCount,
              (SELECT COUNT(*) FROM session_goals g
               WHERE g.session_id = s.id AND g.status IN ('pending', 'in_progress', 'blocked')) as openGoalCount
       FROM sessions s
       WHERE s.user_id = ?
       ORDER BY s.starred DESC, lastActivity DESC`
    )
    .all(principal.userId) as SessionRow[];

  res.json({ success: true, data: rows.map(formatSession) });
});

router.get(
  '/sessions/:id/status',
  requireAutomation(['sessions:read', 'goals:read']),
  rateLimiters.standard,
  (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      throw new AppError('Session id required', 400, 'VALIDATION_ERROR');
    }
    const parsed = statusQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Invalid query', 400, 'VALIDATION_ERROR');
    }
    const principal = currentPrincipal(req);
    const session = getOwnedSession(sessionId, principal.userId);

    res.json({
      success: true,
      data: {
        session: formatSession(session),
        goals: listSessionGoals(sessionId),
        recentMessages: getRecentMessages(sessionId, parsed.data.recentMessages),
      },
    });
  }
);

router.get('/goals', requireAutomation(['goals:read']), rateLimiters.standard, (req, res) => {
  const parsed = listGoalsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError('Invalid query', 400, 'VALIDATION_ERROR');
  }
  const principal = currentPrincipal(req);
  const statuses = parseGoalStatusFilter(parsed.data.status);
  const params: unknown[] = [principal.userId];
  let statusFilter = '';
  if (statuses) {
    statusFilter = `AND g.status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  }
  params.push(parsed.data.limit);

  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT g.id, g.session_id as sessionId, g.title, g.instructions, g.status, g.priority,
              g.metadata_json as metadataJson, g.created_by_user_id as createdByUserId,
              g.created_by_token_id as createdByTokenId,
              strftime('%Y-%m-%dT%H:%M:%fZ', g.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', g.updated_at) as updatedAt,
              s.name as sessionName, s.working_directory as workingDirectory
       FROM session_goals g
       JOIN sessions s ON s.id = g.session_id
       WHERE s.user_id = ? ${statusFilter}
       ORDER BY
         CASE g.status
           WHEN 'in_progress' THEN 0
           WHEN 'blocked' THEN 1
           WHEN 'pending' THEN 2
           ELSE 3
         END,
         g.priority DESC,
         g.created_at DESC
       LIMIT ?`
    )
    .all(...params) as GoalRow[];

  res.json({ success: true, data: rows.map(formatGoal) });
});

router.get(
  '/sessions/:id/goals',
  requireAutomation(['goals:read']),
  rateLimiters.standard,
  (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      throw new AppError('Session id required', 400, 'VALIDATION_ERROR');
    }
    const principal = currentPrincipal(req);
    getOwnedSession(sessionId, principal.userId);
    res.json({ success: true, data: listSessionGoals(sessionId) });
  }
);

router.post(
  '/sessions/:id/goals',
  requireAutomation(['goals:write']),
  rateLimiters.strict,
  (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      throw new AppError('Session id required', 400, 'VALIDATION_ERROR');
    }
    const parsed = createGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid goal payload', 400, 'VALIDATION_ERROR');
    }
    const principal = currentPrincipal(req);
    getOwnedSession(sessionId, principal.userId);

    const goalId = nanoid();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO session_goals
        (id, session_id, created_by_user_id, created_by_token_id, title, instructions, status, priority, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      goalId,
      sessionId,
      principal.userId,
      principal.tokenId,
      parsed.data.title,
      parsed.data.instructions ?? null,
      parsed.data.status,
      parsed.data.priority,
      parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null
    );

    const context = getRequestContext(req);
    recordAudit({
      actorUserId: principal.userId,
      action: 'automation.goal.created',
      resourceType: 'session_goal',
      resourceId: goalId,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: {
        sessionId,
        authType: principal.type,
        tokenId: principal.tokenId,
        status: parsed.data.status,
      },
    });

    const row = assertGoalOwnership(goalId, principal.userId);
    res.status(201).json({ success: true, data: formatGoal(row) });
  }
);

router.patch('/goals/:id', requireAutomation(['goals:write']), rateLimiters.strict, (req, res) => {
  const goalId = req.params.id;
  if (!goalId) {
    throw new AppError('Goal id required', 400, 'VALIDATION_ERROR');
  }
  const parsed = updateGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid goal payload', 400, 'VALIDATION_ERROR');
  }

  const principal = currentPrincipal(req);
  const existing = assertGoalOwnership(goalId, principal.userId);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.title !== undefined) {
    updates.push('title = ?');
    values.push(parsed.data.title);
  }
  if (parsed.data.instructions !== undefined) {
    updates.push('instructions = ?');
    values.push(parsed.data.instructions);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.priority !== undefined) {
    updates.push('priority = ?');
    values.push(parsed.data.priority);
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'metadata')) {
    updates.push('metadata_json = ?');
    values.push(parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(goalId);
    getDatabase()
      .prepare(`UPDATE session_goals SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  const context = getRequestContext(req);
  recordAudit({
    actorUserId: principal.userId,
    action: 'automation.goal.updated',
    resourceType: 'session_goal',
    resourceId: goalId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: {
      sessionId: existing.sessionId,
      authType: principal.type,
      tokenId: principal.tokenId,
      changedFields: updates
        .map((update) => update.split(' = ')[0])
        .filter((field) => field !== 'updated_at'),
    },
  });

  const row = assertGoalOwnership(goalId, principal.userId);
  res.json({ success: true, data: formatGoal(row) });
});

router.post(
  '/sessions/:id/messages',
  requireAutomation(['sessions:message']),
  rateLimiters.messaging,
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      throw new AppError('Session id required', 400, 'VALIDATION_ERROR');
    }
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid message payload', 400, 'VALIDATION_ERROR');
    }

    const principal = currentPrincipal(req);
    getOwnedSession(sessionId, principal.userId);
    if (parsed.data.goalId) {
      const goal = assertGoalOwnership(parsed.data.goalId, principal.userId);
      if (goal.sessionId !== sessionId) {
        throw new AppError('Goal belongs to a different session', 400, 'VALIDATION_ERROR');
      }
    }

    await getProcessManager().sendMessage(sessionId, principal.userId, parsed.data.message);

    if (parsed.data.goalId) {
      getDatabase()
        .prepare(
          `UPDATE session_goals
           SET status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(parsed.data.goalId);
    }

    const context = getRequestContext(req);
    recordAudit({
      actorUserId: principal.userId,
      action: 'automation.session.message_sent',
      resourceType: 'session',
      resourceId: sessionId,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: {
        authType: principal.type,
        tokenId: principal.tokenId,
        goalId: parsed.data.goalId ?? null,
        messageLength: parsed.data.message.length,
      },
    });

    res.status(202).json({
      success: true,
      data: {
        sessionId,
        goalId: parsed.data.goalId ?? null,
        accepted: true,
        runtime: runtimeFor(sessionId),
      },
    });
  })
);

export default router;
