import { Router, type NextFunction, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import multer from 'multer';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import { safeJsonParse } from '../utils/json';
import { rateLimiters } from '../middleware/rateLimiter';
import { getProcessManager } from '../websocket';
import { isAllowedBasePath } from '../utils/allowedPaths';
import { sanitizeFilename, ALLOWED_UPLOAD_MIME_TYPES } from '../utils/sanitize';
import { resolveConfigHome } from '../utils/configPaths';
import { readSkillLibraryItem } from '../utils/skillLibrary';
import { resolveContextWindow as contextWindowFor } from '../utils/contextWindow.js';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers';
import { readLatestCodexContextSnapshot } from '../services/claude/ClaudeProcessManager';
import { comfyui } from '../services/comfyui';
import { scanProject } from '../utils/projectScanner';

const router = Router();

// Validation schemas
const createSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workingDirectory: z.string().optional(), // Optional - will be auto-generated from name
  cliProvider: z.enum(['claude', 'codex', 'opencode', 'vibe']).optional().default('codex'),
  cliModel: z.string().trim().min(1).max(200).nullable().optional(),
  cliReasoning: z.string().trim().min(1).max(50).nullable().optional(),
  cliServiceTier: z.enum(['fast']).nullable().optional(),
  mode: z.enum(['planning', 'auto-accept', 'manual', 'danger']).optional().default('auto-accept'),
  surface: z.enum(['code', 'task']).optional().default('code'),
  initialMessage: z.string().trim().min(1).max(40000).optional(),
});

const updateSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workingDirectory: z.string().min(1).optional(),
});

const updateProviderSchema = z.object({
  cliProvider: z.enum(['claude', 'codex', 'opencode', 'vibe']),
});

const updateSessionModelSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable().optional(),
});

const updateSessionReasoningSchema = z.object({
  reasoning: z.string().trim().min(1).max(50).nullable().optional(),
});

const updateSessionServiceTierSchema = z.object({
  serviceTier: z.enum(['fast']).nullable().optional(),
});

const updateModeSchema = z.object({
  mode: z.enum(['planning', 'auto-accept', 'manual', 'danger']),
});

const updateSurfaceSchema = z.object({
  surface: z.enum(['code', 'task']),
});

const updateSessionStylesSchema = z.object({
  designStyleSkill: z.string().min(1).max(100).nullable().optional(),
  writingStyleSkill: z.string().min(1).max(100).nullable().optional(),
});

const generateSessionIconSchema = z.object({
  prompt: z.string().trim().min(3).max(800).optional(),
});

const SESSION_ICON_DIR =
  process.env.SESSION_ICON_DIR ||
  path.resolve(process.cwd(), 'packages/backend/data/session-icons');
const GENERATED_IMAGE_DIR =
  process.env.COMFYUI_OUTPUT_DIR || path.resolve(process.cwd(), 'packages/backend/data/generated');
const MAX_ICON_BYTES = 6 * 1024 * 1024;

const ICON_EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/svg+xml': '.svg',
};

const ICON_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const ALLOWED_ICON_EXTENSIONS = new Set(Object.keys(ICON_MIME_BY_EXT));
const AUTO_GOAL_MIN_CHARS = 220;
const AUTO_GOAL_MAX_CHARS = 3200;
const AUTO_GOAL_ACTION_HINT =
  /\b(add|build|connect|create|debug|design|finish|fix|implement|integrate|migrate|polish|refactor|rewrite|ship|test|update|wire)\b/i;

const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ICON_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ICON_EXT_BY_MIME[file.mimetype] || ALLOWED_ICON_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported icon type: ${file.mimetype || ext || 'unknown'}`));
  },
});

const createSessionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (
      ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype) ||
      !file.mimetype ||
      file.mimetype === '' ||
      file.mimetype.startsWith('text/')
    ) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype || file.originalname || 'unknown'}`));
  },
});

function parseCreateSessionUpload(req: Request, res: Response, next: NextFunction) {
  createSessionUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'File too large (max 50MB)'
            : err.code === 'LIMIT_FILE_COUNT'
              ? 'Too many files (max 20)'
              : err.message;
        return res.status(400).json({
          success: false,
          error: { message, code: err.code },
        });
      }
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 'UPLOAD_ERROR' },
      });
    }
    next();
  });
}

// Validate working directory
function validateWorkingDirectory(dir: string): boolean {
  return isAllowedBasePath(dir);
}

// Sanitize session name for folder creation
function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => {
      const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
      return map[char] || char;
    })
    .replace(/[^a-z0-9-_]/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length
}

async function persistCreateSessionUploads(
  files: Express.Multer.File[] | undefined,
  workingDirectory: string
) {
  if (!files || files.length === 0) return [];

  const uploads = [];
  for (const file of files) {
    const filename = sanitizeFilename(file.originalname);
    const destination = path.join(workingDirectory, filename);
    await fs.writeFile(destination, file.buffer);
    uploads.push({
      name: filename,
      path: destination,
      size: file.size,
    });
  }

  return uploads;
}

function buildAutoGoalObjective(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const lineCount = trimmed.split(/\n/).filter((line) => line.trim()).length;
  const hasLongShape =
    trimmed.length >= AUTO_GOAL_MIN_CHARS ||
    lineCount >= 4 ||
    (trimmed.length >= 140 && AUTO_GOAL_ACTION_HINT.test(trimmed));

  if (!hasLongShape) return null;

  const compact = trimmed.replace(/\s+/g, ' ');
  const clipped =
    compact.length > AUTO_GOAL_MAX_CHARS
      ? `${compact.slice(0, AUTO_GOAL_MAX_CHARS - 3).trim()}...`
      : compact;

  return `Work through this request end-to-end and maintain an updated todo list: ${clipped}`;
}

// Ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function sessionIconSelect(prefix = ''): string {
  const p = prefix ? `${prefix}.` : '';
  return `CASE
                WHEN ${p}icon_path IS NOT NULL AND ${p}icon_path != ''
                THEN '/api/sessions/' || ${p}id || '/icon?v=' || COALESCE(strftime('%s', ${p}updated_at), '')
                ELSE NULL
              END as iconUrl,
              ${p}icon_source as iconSource`;
}

function getIconExtension(filename: string | undefined, mimetype?: string): string {
  const fromMime = mimetype ? ICON_EXT_BY_MIME[mimetype] : null;
  const fromName = path.extname(filename || '').toLowerCase();
  const ext = fromMime || fromName || '.png';
  if (!ALLOWED_ICON_EXTENSIONS.has(ext)) {
    throw new AppError('Unsupported icon file type', 400, 'INVALID_ICON');
  }
  return ext === '.jpeg' ? '.jpg' : ext;
}

function assertSafeSvg(buffer: Buffer): void {
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 256 * 1024)).toLowerCase();
  if (
    content.includes('<script') ||
    content.includes('javascript:') ||
    content.includes('<foreignobject') ||
    /\son[a-z]+\s*=/.test(content)
  ) {
    throw new AppError('SVG icon contains unsafe markup', 400, 'INVALID_ICON');
  }
}

function resolveSessionIconPath(iconPath: string): string {
  const base = path.resolve(SESSION_ICON_DIR);
  const resolved = path.resolve(iconPath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new AppError('Stored icon path is invalid', 500, 'INVALID_ICON_PATH');
  }
  return resolved;
}

async function removeExistingSessionIcons(sessionId: string): Promise<void> {
  await ensureDir(SESSION_ICON_DIR);
  const entries = await fs.readdir(SESSION_ICON_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${sessionId}-`))
      .map((entry) => fs.unlink(path.join(SESSION_ICON_DIR, entry)).catch(() => undefined))
  );
}

function selectSessionById(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  userId?: string
): Record<string, unknown> | undefined {
  const whereUser = userId ? 'AND s.user_id = ?' : '';
  const params = userId ? [sessionId, userId] : [sessionId];
  return db
    .prepare(
      `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
              ${sessionIconSelect('s')},
              s.starred, s.category, s.cli_provider as cliProvider, s.mode, s.surface,
              s.cli_model as cliModel, s.cli_reasoning as cliReasoning,
              s.cli_service_tier as cliServiceTier,
              s.design_style_skill as designStyleSkill,
              s.writing_style_skill as writingStyleSkill,
              s.android_device_serial as androidDeviceSerial,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt
       FROM sessions s WHERE s.id = ? ${whereUser}`
    )
    .get(...params) as Record<string, unknown> | undefined;
}

async function storeSessionIcon(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  userId: string,
  buffer: Buffer,
  ext: string,
  source: 'upload' | 'project' | 'generated'
): Promise<Record<string, unknown>> {
  if (buffer.length > MAX_ICON_BYTES) {
    throw new AppError('Icon file is too large', 400, 'ICON_TOO_LARGE');
  }
  if (ext === '.svg') assertSafeSvg(buffer);
  await ensureDir(SESSION_ICON_DIR);
  await removeExistingSessionIcons(sessionId);
  const filename = `${sessionId}-${nanoid(10)}${ext}`;
  const iconPath = path.join(SESSION_ICON_DIR, filename);
  await fs.writeFile(iconPath, buffer);
  db.prepare(
    `UPDATE sessions
     SET icon_path = ?, icon_source = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  ).run(iconPath, source, sessionId, userId);
  const updated = selectSessionById(db, sessionId, userId);
  if (!updated) throw new AppError('Session not found', 404, 'NOT_FOUND');
  return { ...updated, starred: Boolean(updated.starred) };
}

async function readProjectIconCandidate(projectPath: string): Promise<{
  path: string;
  buffer: Buffer;
  ext: string;
} | null> {
  const candidates = [
    '.plum/icon.png',
    '.plum/icon.webp',
    '.plum/icon.jpg',
    '.plum/icon.svg',
    'plum-icon.png',
    'icon.png',
    'icon.webp',
    'favicon.png',
    'favicon.ico',
    'public/icon.png',
    'public/icon.webp',
    'public/favicon.png',
    'public/favicon.ico',
    'public/favicon.svg',
    'app/icon.png',
    'app/favicon.ico',
    'src-tauri/icons/icon.png',
    'src-tauri/icons/128x128.png',
    'assets/icon.png',
    'assets/favicon.png',
    'resources/icon.png',
  ];

  for (const rel of candidates) {
    const candidate = path.join(projectPath, rel);
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
      const ext = getIconExtension(candidate);
      const buffer = await fs.readFile(candidate);
      return { path: candidate, buffer, ext };
    } catch {
      // try next candidate
    }
  }

  for (const manifest of ['public/manifest.json', 'public/site.webmanifest', 'manifest.json']) {
    try {
      const manifestPath = path.join(projectPath, manifest);
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = safeJsonParse<{ icons?: Array<{ src?: string; sizes?: string }> }>(raw, {});
      const icon = parsed.icons
        ?.slice()
        .sort((a, b) => (b.sizes || '').localeCompare(a.sizes || ''))
        .find((item) => item.src);
      if (!icon?.src) continue;
      const src = icon.src.replace(/^\//, '');
      const candidate = path.resolve(path.dirname(manifestPath), src);
      if (!candidate.startsWith(path.resolve(projectPath))) continue;
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
      const ext = getIconExtension(candidate);
      const buffer = await fs.readFile(candidate);
      return { path: candidate, buffer, ext };
    } catch {
      // try next manifest
    }
  }

  return null;
}

function buildGeneratedIconPrompt(session: { name: string; workingDirectory: string }): string {
  const projectName = path.basename(session.workingDirectory);
  return [
    `Create a polished square app icon for a developer workspace session named "${session.name}".`,
    `Project folder: "${projectName}".`,
    'Use a single centered abstract symbol that suggests software, tooling, and focused work.',
    'Modern premium icon, high contrast, crisp edges, dark transparent-looking background, subtle depth.',
    'No words, no letters, no numbers, no watermark, no UI screenshot, no tiny details.',
  ].join(' ');
}

function attachRuntime<T extends Record<string, unknown>>(session: T): T & { runtime: unknown } {
  const id = typeof session.id === 'string' ? session.id : '';
  return {
    ...session,
    runtime: id ? getProcessManager().getSessionRuntimeSnapshot(id) : null,
  };
}

interface SessionUsageSnapshot {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  contextWindow: number;
  contextUsedPercent: number;
  contextUsedPercentRaw?: number;
  contextExceeded?: boolean;
  totalCostUsd: number;
  model: string;
  recordedAt?: string;
}

interface SessionTelemetry {
  usage: SessionUsageSnapshot | null;
  contextSnapshots: number;
  compactEvents: number;
}

function getSessionTelemetrySnapshot(
  session: {
    id: string;
    userId: string;
    cliProvider: CLIProvider | null;
    cliModel?: string | null;
    claudeSessionId?: string | null;
    workingDirectory?: string | null;
  },
  runtime?: { model: string | null; usage?: SessionUsageSnapshot | null } | null
): SessionTelemetry {
  const db = getDatabase();
  const counts = db
    .prepare(
      `
      SELECT event_type as eventType, COUNT(*) as count
      FROM session_events
      WHERE session_id = ? AND user_id = ?
      GROUP BY event_type
    `
    )
    .all(session.id, session.userId) as Array<{ eventType: string; count: number }>;

  let contextSnapshots = 0;
  let compactEvents = 0;
  for (const row of counts) {
    if (row.eventType === 'context_snapshot') {
      contextSnapshots = row.count;
    } else if (row.eventType === 'compact') {
      compactEvents = row.count;
    }
  }

  const latestContext = db
    .prepare(
      `
      SELECT
        session_id as sessionId,
        input_tokens as inputTokens,
        output_tokens as outputTokens,
        cache_read_tokens as cacheReadTokens,
        cache_creation_tokens as cacheCreationTokens,
        total_tokens as totalTokens,
        context_window as contextWindow,
        context_used_percent as contextUsedPercent,
        context_exceeded as contextExceeded,
        model,
        metadata_json as metadataJson,
        created_at as createdAt
      FROM session_events
      WHERE session_id = ? AND user_id = ? AND event_type = 'context_snapshot'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `
    )
    .get(session.id, session.userId) as
    | {
        sessionId: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        totalTokens: number;
        contextWindow: number;
        contextUsedPercent: number;
        contextExceeded: number;
        model: string | null;
        metadataJson: string | null;
        createdAt: string | null;
      }
    | undefined;

  const runtimeModel = runtime?.model && runtime.model !== 'unknown' ? runtime.model.trim() : null;
  const sessionModel =
    session.cliModel && session.cliModel !== 'unknown' ? session.cliModel.trim() : null;
  const fallbackModel =
    latestContext?.model?.trim() ||
    runtimeModel ||
    sessionModel ||
    (session.cliProvider ? CLI_PROVIDERS[session.cliProvider]?.defaultModel : null) ||
    null;
  const normalizedModel = fallbackModel || 'unknown';
  const fallbackContextWindow = contextWindowFor(fallbackModel);
  const latestMetadata = safeJsonParse<Record<string, unknown>>(latestContext?.metadataJson, {});
  const latestTotalCost =
    typeof latestMetadata.totalCostUsd === 'number' ? latestMetadata.totalCostUsd : 0;
  const latestRecordedAt = latestContext?.createdAt
    ? new Date(`${latestContext.createdAt.replace(' ', 'T')}Z`).toISOString()
    : undefined;

  const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
  const codexContext =
    session.cliProvider === 'codex'
      ? readLatestCodexContextSnapshot(codexHome, {
          threadId: session.claudeSessionId,
          cwd: session.workingDirectory,
        })
      : null;
  const codexContextUsage: SessionUsageSnapshot | null = codexContext
    ? (() => {
        const contextWindow = codexContext.contextWindow || fallbackContextWindow;
        const inputTotal = Math.max(codexContext.counters.input, 0);
        const cached = Math.min(Math.max(codexContext.counters.cached, 0), inputTotal);
        const output = Math.max(codexContext.counters.output, 0);
        const totalTokens = contextWindow > 0 ? Math.min(inputTotal + output, contextWindow) : 0;
        const contextUsedPercentRaw =
          contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 100) : 0;
        return {
          sessionId: session.id,
          inputTokens: Math.max(inputTotal - cached, 0),
          outputTokens: output,
          cacheReadTokens: cached,
          cacheCreationTokens: 0,
          totalTokens,
          contextWindow,
          contextUsedPercent: Math.max(0, Math.min(100, contextUsedPercentRaw)),
          contextUsedPercentRaw,
          contextExceeded: false,
          totalCostUsd: latestTotalCost,
          model: codexContext.model || normalizedModel,
          recordedAt: codexContext.recordedAt,
        };
      })()
    : null;

  const dbUsage: SessionUsageSnapshot | null = latestContext
    ? {
        sessionId: session.id,
        inputTokens: latestContext.inputTokens || 0,
        outputTokens: latestContext.outputTokens || 0,
        cacheReadTokens: latestContext.cacheReadTokens || 0,
        cacheCreationTokens: latestContext.cacheCreationTokens || 0,
        totalTokens: latestContext.totalTokens || 0,
        contextWindow: latestContext.contextWindow || fallbackContextWindow,
        contextUsedPercent: Math.max(0, Math.min(100, latestContext.contextUsedPercent || 0)),
        contextUsedPercentRaw: latestContext.contextUsedPercent || 0,
        contextExceeded: Boolean(latestContext.contextExceeded),
        totalCostUsd: latestTotalCost,
        model: normalizedModel,
        recordedAt: latestRecordedAt,
      }
    : fallbackContextWindow > 0
      ? {
          sessionId: session.id,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 0,
          contextWindow: fallbackContextWindow,
          contextUsedPercent: 0,
          contextUsedPercentRaw: 0,
          contextExceeded: false,
          totalCostUsd: 0,
          model: normalizedModel,
          recordedAt: undefined,
        }
      : null;

  const rawRuntimeUsage = runtime?.usage || null;
  const runtimeUsage =
    rawRuntimeUsage &&
    rawRuntimeUsage.totalTokens <= 0 &&
    codexContextUsage &&
    codexContextUsage.totalTokens > 0
      ? null
      : rawRuntimeUsage &&
          rawRuntimeUsage.contextUsedPercent >= 100 &&
          codexContextUsage &&
          codexContextUsage.contextUsedPercent < 100
        ? null
        : rawRuntimeUsage;
  const usageCandidates = [dbUsage, codexContextUsage, runtimeUsage].filter(
    Boolean
  ) as SessionUsageSnapshot[];
  const selectedUsage = usageCandidates.reduce<SessionUsageSnapshot | null>((best, candidate) => {
    if (!best) return candidate;
    const bestMs = best.recordedAt ? Date.parse(best.recordedAt) : 0;
    const candidateMs = candidate.recordedAt ? Date.parse(candidate.recordedAt) : 0;
    if (candidateMs > bestMs) return candidate;
    if (
      candidateMs === bestMs &&
      best.contextUsedPercent >= 100 &&
      candidate.contextUsedPercent < 100
    ) {
      return candidate;
    }
    return best;
  }, null);
  const usage =
    session.cliProvider === 'codex' && codexContextUsage ? codexContextUsage : selectedUsage;

  return { usage, contextSnapshots, compactEvents };
}

function attachRuntimeAndTelemetry<T extends Record<string, unknown>>(
  session: T
): T & { runtime: unknown; telemetry: SessionTelemetry | null } {
  const id = typeof session.id === 'string' ? session.id : '';
  const runtime = id ? getProcessManager().getSessionRuntimeSnapshot(id) : null;
  const telemetry =
    id &&
    typeof session.userId === 'string' &&
    session.userId &&
    typeof session.cliProvider === 'string'
      ? getSessionTelemetrySnapshot(
          {
            id,
            userId: session.userId,
            cliProvider: session.cliProvider as CLIProvider,
            cliModel: typeof session.cliModel === 'string' ? session.cliModel : null,
            claudeSessionId:
              typeof session.claudeSessionId === 'string' ? session.claudeSessionId : null,
            workingDirectory:
              typeof session.workingDirectory === 'string' ? session.workingDirectory : null,
          },
          runtime
        )
      : null;
  return {
    ...session,
    runtime,
    telemetry,
  };
}

// List all sessions
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Sort by message activity (latest message wins) with updated_at as fallback for
  // sessions that have no messages yet. Starred sessions always float to the top.
  const sessions = db
    .prepare(
      `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
	              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
	              ${sessionIconSelect('s')},
	              s.starred, s.category, s.cli_provider as cliProvider, s.mode, s.surface,
              s.cli_model as cliModel, s.cli_reasoning as cliReasoning,
              s.cli_service_tier as cliServiceTier,
              s.design_style_skill as designStyleSkill,
              s.writing_style_skill as writingStyleSkill,
              s.android_device_serial as androidDeviceSerial,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(
                (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id),
                s.updated_at
              )) as lastActivity
       FROM sessions s
       WHERE s.user_id = ?
       ORDER BY s.starred DESC, lastActivity DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const sessionsWithStarred = sessions.map((s) =>
    attachRuntime({ ...s, starred: Boolean(s.starred) })
  );

  res.json({ success: true, data: sessionsWithStarred });
});

// Get session by ID
router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const rawSession = selectSessionById(db, req.params.id as string, userId);

  const session = rawSession
    ? attachRuntimeAndTelemetry({ ...rawSession, starred: Boolean(rawSession.starred) })
    : null;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: session });
});

// Create new session (with rate limiting)
router.post(
  '/',
  requireAuth,
  rateLimiters.sessionCreation,
  rateLimiters.upload,
  parseCreateSessionUpload,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const parsed = createSessionSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const {
      name,
      workingDirectory: providedWorkingDir,
      cliProvider,
      cliModel,
      cliReasoning,
      cliServiceTier,
      mode,
      surface,
      initialMessage,
    } = parsed.data;
    const db = getDatabase();
    let storedReasoning = cliReasoning?.trim() || null;
    let storedServiceTier = cliProvider === 'codex' ? cliServiceTier || null : null;

    if (cliProvider === 'codex' && storedReasoning?.toLowerCase() === 'fast') {
      storedReasoning = null;
      storedServiceTier = 'fast';
    }

    let workingDirectory: string;

    if (providedWorkingDir) {
      // User selected an existing folder - use it directly
      workingDirectory = path.resolve(providedWorkingDir);

      if (!validateWorkingDirectory(workingDirectory)) {
        throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
      }

      // Verify the directory exists
      try {
        const stat = await fs.stat(workingDirectory);
        if (!stat.isDirectory()) {
          throw new AppError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AppError('Directory does not exist', 400, 'DIR_NOT_FOUND');
        }
        throw err;
      }
    } else {
      // No folder specified - create subfolder based on session name (original behavior)
      const settings = db
        .prepare(
          'SELECT default_working_dir as defaultWorkingDir FROM user_settings WHERE user_id = ?'
        )
        .get(userId) as { defaultWorkingDir: string | null } | undefined;

      const defaultWorkingDir = settings?.defaultWorkingDir;

      if (!defaultWorkingDir) {
        throw new AppError(
          'Please set a default working directory in Settings first',
          400,
          'NO_DEFAULT_DIR'
        );
      }

      const folderName = sanitizeFolderName(name);
      if (!folderName) {
        throw new AppError('Session name must contain valid characters', 400, 'INVALID_NAME');
      }

      workingDirectory = path.join(defaultWorkingDir, folderName);

      if (!validateWorkingDirectory(workingDirectory)) {
        throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
      }

      // Create the directory
      await ensureDir(workingDirectory);
    }

    await persistCreateSessionUploads(
      req.files as Express.Multer.File[] | undefined,
      workingDirectory
    );

    const sessionId = nanoid();

    db.prepare(
      `INSERT INTO sessions (
       id,
       user_id,
       name,
       working_directory,
       cli_provider,
       mode,
       surface,
       cli_model,
       cli_reasoning,
       cli_service_tier
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      userId,
      name,
      workingDirectory,
      cliProvider,
      mode,
      surface,
      cliModel?.trim() || null,
      storedReasoning,
      storedServiceTier
    );

    const newSession = selectSessionById(db, sessionId, userId) as Record<string, unknown>;

    res.status(201).json({
      success: true,
      data: attachRuntimeAndTelemetry({ ...newSession, starred: Boolean(newSession.starred) }),
    });

    if (initialMessage) {
      void (async () => {
        try {
          const manager = getProcessManager();
          if (cliProvider === 'codex') {
            const objective = buildAutoGoalObjective(initialMessage);
            if (objective) {
              await manager.sendMessage(sessionId, userId, `/goal ${objective}`);
            }
          }
          await manager.sendMessage(sessionId, userId, initialMessage);
        } catch (error) {
          console.error('[Sessions] Failed to send initial dashboard message:', error);
        }
      })();
    }
  }
);

// Update session
router.put('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const { name, workingDirectory } = parsed.data;
  const resolvedWorkingDirectory = workingDirectory ? path.resolve(workingDirectory) : null;

  if (resolvedWorkingDirectory && !validateWorkingDirectory(resolvedWorkingDirectory)) {
    throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }
  if (resolvedWorkingDirectory) {
    updates.push('working_directory = ?');
    values.push(resolvedWorkingDirectory);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);
    db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updatedSession = selectSessionById(db, req.params.id as string, userId) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Toggle session starred status
router.patch('/:id/star', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Verify session ownership
  const session = db
    .prepare('SELECT id, starred FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; starred: number } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  // Toggle starred status
  const newStarred = session.starred ? 0 : 1;
  db.prepare('UPDATE sessions SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    newStarred,
    req.params.id
  );

  res.json({ success: true, data: { starred: Boolean(newStarred) } });
});

// Update session CLI provider
router.patch('/:id/provider', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateProviderSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; cliProvider: string } | undefined;

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const { cliProvider } = parsed.data;

  if (existing.cliProvider !== cliProvider) {
    db.prepare(
      `UPDATE sessions
       SET cli_provider = ?,
           claude_session_id = NULL,
           cli_model = NULL,
           cli_reasoning = NULL,
           cli_service_tier = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(cliProvider, req.params.id);
  }

  const updatedSession = selectSessionById(db, req.params.id as string, userId) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Update the per-session model selection so different WebUI sessions can run
// different provider/model pairs without changing any global provider default.
router.patch('/:id/model', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionModelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid model', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const session = db
    .prepare('SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const model = parsed.data.model?.trim() || null;
  db.prepare('UPDATE sessions SET cli_model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    model,
    req.params.id
  );

  const updatedSession = selectSessionById(db, req.params.id as string, userId) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Update the per-session reasoning/effort selection. This intentionally mirrors
// the model route: the session row is the source of truth, not user-wide settings.
router.patch('/:id/reasoning', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionReasoningSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid reasoning level', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const session = db
    .prepare('SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const reasoning = parsed.data.reasoning?.trim() || null;
  if (session.cliProvider === 'codex' && reasoning?.toLowerCase() === 'fast') {
    db.prepare(
      `UPDATE sessions
       SET cli_reasoning = NULL,
           cli_service_tier = 'fast',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(req.params.id);
  } else {
    db.prepare(
      'UPDATE sessions SET cli_reasoning = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(reasoning, req.params.id);
  }

  const updatedSession = selectSessionById(db, req.params.id as string, userId) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Update the per-session Codex service/profile tier. This is separate from
// reasoning so `/fast` can be combined with xhigh effort.
router.patch('/:id/service-tier', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionServiceTierSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid service tier', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const session = db
    .prepare('SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const serviceTier = parsed.data.serviceTier || null;
  if (serviceTier && session.cliProvider !== 'codex') {
    throw new AppError(
      'Service tier is only supported for Codex sessions',
      400,
      'VALIDATION_ERROR'
    );
  }

  db.prepare(
    'UPDATE sessions SET cli_service_tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(serviceTier, req.params.id);

  const updatedSession = selectSessionById(db, req.params.id as string, userId) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Persist the session permission mode. Previously lived only in localStorage, so it
// was lost when switching browser or device.
router.patch('/:id/mode', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateModeSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid mode', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  db.prepare('UPDATE sessions SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    parsed.data.mode,
    req.params.id
  );

  res.json({ success: true, data: { mode: parsed.data.mode } });
});

// Persist the visible session surface. This switches between the technical code
// workbench and the quieter task/messenger presentation over the same runtime.
router.patch('/:id/surface', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSurfaceSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid surface', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  db.prepare('UPDATE sessions SET surface = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    parsed.data.surface,
    req.params.id
  );

  res.json({ success: true, data: { surface: parsed.data.surface } });
});

// Persist active style-library templates for the current session. These are not
// normal skills; they are injected as session style context on each user turn.
router.patch(
  '/:id/styles',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) {
      throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
    }

    const parsed = updateSessionStylesSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError('Invalid style selection', 400, 'VALIDATION_ERROR');
    }

    const db = getDatabase();
    const existing = db
      .prepare('SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { id: string; cliProvider: string | null } | undefined;

    if (!existing) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }

    const configHome = resolveConfigHome(existing.cliProvider || 'codex');
    const { designStyleSkill, writingStyleSkill } = parsed.data;
    const updates: string[] = [];
    const values: Array<string | null> = [];

    if (designStyleSkill !== undefined) {
      if (designStyleSkill !== null) {
        const style = await readSkillLibraryItem(configHome, designStyleSkill);
        if (!style || style.libraryKind !== 'design' || !style.enabled) {
          throw new AppError('UI style template not found', 400, 'INVALID_STYLE');
        }
      }
      updates.push('design_style_skill = ?');
      values.push(designStyleSkill);
    }

    if (writingStyleSkill !== undefined) {
      if (writingStyleSkill !== null) {
        const style = await readSkillLibraryItem(configHome, writingStyleSkill);
        if (!style || style.libraryKind !== 'writing' || !style.enabled) {
          throw new AppError('Writing style template not found', 400, 'INVALID_STYLE');
        }
      }
      updates.push('writing_style_skill = ?');
      values.push(writingStyleSkill);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(sessionId);
      db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updatedSession = selectSessionById(db, sessionId, userId) as Record<string, unknown>;

    res.json({
      success: true,
      data: attachRuntimeAndTelemetry({
        ...updatedSession,
        starred: Boolean(updatedSession.starred),
      }),
    });
  })
);

router.get(
  '/:id/icon',
  asyncHandler(async (req, res) => {
    const userId = await validateToken(req, res);
    if (!userId) return;

    const db = getDatabase();
    const row = db
      .prepare('SELECT icon_path as iconPath FROM sessions WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as { iconPath: string | null } | undefined;

    if (!row?.iconPath) {
      throw new AppError('Session icon not found', 404, 'NOT_FOUND');
    }

    const iconPath = resolveSessionIconPath(row.iconPath);
    const ext = path.extname(iconPath).toLowerCase();
    const contentType = ICON_MIME_BY_EXT[ext] || 'application/octet-stream';
    await fs.access(iconPath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(iconPath).pipe(res);
  })
);

router.post(
  '/:id/icon/upload',
  requireAuth,
  rateLimiters.upload,
  iconUpload.single('icon'),
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
    if (!req.file) throw new AppError('Icon file missing', 400, 'NO_FILE');

    const db = getDatabase();
    const existing = db
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!existing) throw new AppError('Session not found', 404, 'NOT_FOUND');

    const ext = getIconExtension(req.file.originalname, req.file.mimetype);
    const updatedSession = await storeSessionIcon(
      db,
      sessionId,
      userId,
      req.file.buffer,
      ext,
      'upload'
    );
    res.json({ success: true, data: attachRuntimeAndTelemetry(updatedSession) });
  })
);

router.post(
  '/:id/icon/project',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

    const db = getDatabase();
    const session = db
      .prepare(
        'SELECT id, working_directory as workingDirectory FROM sessions WHERE id = ? AND user_id = ?'
      )
      .get(sessionId, userId) as { id: string; workingDirectory: string } | undefined;
    if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');

    const projectIcon = await readProjectIconCandidate(session.workingDirectory);
    if (!projectIcon) {
      throw new AppError('No project icon found in this workspace', 404, 'PROJECT_ICON_NOT_FOUND');
    }

    const updatedSession = await storeSessionIcon(
      db,
      sessionId,
      userId,
      projectIcon.buffer,
      projectIcon.ext,
      'project'
    );
    res.json({
      success: true,
      data: attachRuntimeAndTelemetry(updatedSession),
      meta: { sourcePath: projectIcon.path },
    });
  })
);

router.post(
  '/:id/icon/generate',
  requireAuth,
  rateLimiters.imageGeneration,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

    const parsed = generateSessionIconSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('Invalid icon prompt', 400, 'VALIDATION_ERROR');

    const db = getDatabase();
    const session = db
      .prepare(
        `SELECT id, name, working_directory as workingDirectory
         FROM sessions WHERE id = ? AND user_id = ?`
      )
      .get(sessionId, userId) as { id: string; name: string; workingDirectory: string } | undefined;
    if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');

    const scanned = await scanProject(session.workingDirectory).catch(() => null);
    const defaultPrompt = buildGeneratedIconPrompt(session);
    const prompt = [
      parsed.data.prompt?.trim() || defaultPrompt,
      scanned?.framework ? `Framework signal: ${scanned.framework}.` : null,
      scanned?.techStack?.length
        ? `Tech stack: ${scanned.techStack.slice(0, 4).join(', ')}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');

    const job = await comfyui.generateAndWait(
      userId,
      'z-image-turbo',
      {
        prompt,
        negative_prompt:
          'text, letters, words, numbers, watermark, logo text, screenshot, busy background, tiny details, low contrast',
        aspect_ratio: '1:1 (Perfect Square)',
        megapixel: '1.0',
        steps: 9,
        cfg: 2.2,
        filename_prefix: `session-icon-${sessionId}`,
      },
      { timeoutMs: 2 * 60 * 1000 }
    );

    if (job.status !== 'completed' || !job.outputFilename) {
      throw new AppError(job.error || 'Icon generation failed', 502, 'GENERATE_FAILED');
    }

    const generatedPath = path.join(GENERATED_IMAGE_DIR, job.outputFilename);
    const buffer = await fs.readFile(generatedPath);
    const updatedSession = await storeSessionIcon(
      db,
      sessionId,
      userId,
      buffer,
      '.png',
      'generated'
    );
    res.json({
      success: true,
      data: attachRuntimeAndTelemetry(updatedSession),
      meta: { generationId: job.id, prompt, seed: job.seed ?? null },
    });
  })
);

router.delete(
  '/:id/icon',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

    const db = getDatabase();
    const existing = db
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!existing) throw new AppError('Session not found', 404, 'NOT_FOUND');

    await removeExistingSessionIcons(sessionId);
    db.prepare(
      `UPDATE sessions
       SET icon_path = NULL, icon_source = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    ).run(sessionId, userId);

    const updatedSession = selectSessionById(db, sessionId, userId);
    res.json({
      success: true,
      data: attachRuntimeAndTelemetry({
        ...updatedSession,
        starred: Boolean(updatedSession?.starred),
      }),
    });
  })
);

// Delete session
router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) {
    throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
  }
  const db = getDatabase();

  // Stop any live CLI process before the row disappears, otherwise the
  // process keeps writing to a dead session_id (zombie).
  try {
    getProcessManager().stopSession(sessionId, userId);
  } catch {
    // Not running or not owned — safe to ignore; ownership is re-checked by DELETE.
  }

  const result = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(sessionId, userId);

  if (result.changes === 0) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Get session messages. Paginated so a 10k-message session doesn't
// blow up memory on the server or freeze the frontend on render.
// Default returns the most recent `limit` messages in chronological order.
// Use `before` (message id) to page backwards for infinite scroll.
const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  before: z.string().max(64).optional(),
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const session = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const parsed = messagesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('Invalid query', 400, 'VALIDATION_ERROR');
  const { limit, before } = parsed.data;

  let cursorRowId: number | null = null;
  if (before) {
    const row = db
      .prepare('SELECT rowid as rid FROM messages WHERE id = ? AND session_id = ?')
      .get(before, req.params.id) as { rid: number } | undefined;
    if (row) cursorRowId = row.rid;
  }

  // Fetch newest-first (so `limit` keeps the tail window), reverse for the client.
  // `created_at` is formatted as ISO 8601 UTC so the browser parses it as a real
  // moment in time. SQLite's `CURRENT_TIMESTAMP` default writes `YYYY-MM-DD HH:MM:SS`
  // without a TZ marker — which `new Date(...)` interprets as LOCAL time, shifting
  // messages by the user's UTC offset and breaking timeline ordering against
  // backend-clock-stamped tool events. See websocket.ts: emitToolUse().
  const rows =
    cursorRowId !== null
      ? (db
          .prepare(
            `SELECT id, session_id as sessionId, role, content,
                strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt, rowid as rid
         FROM messages WHERE session_id = ? AND rowid < ?
         ORDER BY rowid DESC LIMIT ?`
          )
          .all(req.params.id, cursorRowId, limit) as Array<{ rid: number; [k: string]: unknown }>)
      : (db
          .prepare(
            `SELECT id, session_id as sessionId, role, content,
                strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt, rowid as rid
         FROM messages WHERE session_id = ?
         ORDER BY rowid DESC LIMIT ?`
          )
          .all(req.params.id, limit) as Array<{ rid: number; [k: string]: unknown }>);

  const total = (
    db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id = ?').get(req.params.id) as {
      c: number;
    }
  ).c;

  const ordered = rows.slice().reverse();
  const oldestRid = ordered[0]?.rid ?? null;
  const hasMore =
    oldestRid !== null &&
    rows.length === limit &&
    db
      .prepare('SELECT 1 FROM messages WHERE session_id = ? AND rowid < ? LIMIT 1')
      .get(req.params.id, oldestRid) !== undefined;

  // Strip the synthetic `rid` before returning.
  const messages = ordered.map(({ rid: _rid, ...rest }) => rest);

  res.json({
    success: true,
    data: messages,
    pagination: {
      total,
      limit,
      hasMore,
      oldestId: messages.length ? (messages[0] as { id: string }).id : null,
    },
  });
});

// Rewind session to a specific message (deletes that message and all later ones,
// resets the Claude session so the next user message starts a fresh context)
const rewindSchema = z.object({
  messageId: z.string().min(1),
});

router.post('/:id/rewind', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) {
    throw new AppError('Session id required', 400, 'INVALID_PAYLOAD');
  }
  const db = getDatabase();

  const parsed = rewindSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid rewind payload', 400, 'INVALID_PAYLOAD');
  }
  const { messageId } = parsed.data;

  const session = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const target = db
    .prepare(
      'SELECT rowid as rid, created_at as createdAt FROM messages WHERE id = ? AND session_id = ?'
    )
    .get(messageId, sessionId) as { rid: number; createdAt: string } | undefined;
  if (!target) {
    throw new AppError('Message not found', 404, 'NOT_FOUND');
  }

  // Order: stop process → clear buffer → DB transaction. Stopping first prevents new
  // messages from streaming in during the delete; clearing the buffer ensures that on
  // reconnect the client doesn't replay the now-deleted tail. The DB update is one
  // transaction so a partial failure can't leave "claude_session_id set but messages gone".
  const pm = getProcessManager();
  try {
    pm.stopSession(sessionId, userId);
  } catch {
    // Process not running or not owned by this user — safe to ignore.
  }
  pm.clearSessionBuffer(sessionId);

  const result = db.transaction(() => {
    const del = db
      .prepare('DELETE FROM messages WHERE session_id = ? AND rowid >= ?')
      .run(sessionId, target.rid);
    db.prepare('DELETE FROM session_events WHERE session_id = ? AND created_at >= ?').run(
      sessionId,
      target.createdAt
    );
    db.prepare(
      'UPDATE sessions SET claude_session_id = NULL, status = ?, last_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('stopped', sessionId);
    return del.changes;
  })();

  const remaining = db
    .prepare(
      `SELECT id, session_id as sessionId, role, content,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
       FROM messages WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId);

  res.json({ success: true, deletedCount: result, data: remaining });
});

// Get allowed directories for a session
router.get('/:id/allowed-directories', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const session = db
    .prepare('SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  res.json({ success: true, data: allowedDirectories });
});

// Add an allowed directory to a session
router.post('/:id/allowed-directories', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { directory } = req.body;

  if (!directory || typeof directory !== 'string') {
    throw new AppError('Directory path is required', 400, 'VALIDATION_ERROR');
  }

  // Normalize and validate the directory path
  const normalizedDir = path.resolve(directory);

  // Check if directory exists
  try {
    const stat = await fs.stat(normalizedDir);
    if (!stat.isDirectory()) {
      throw new AppError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Directory does not exist', 400, 'DIR_NOT_FOUND');
    }
    throw err;
  }

  const db = getDatabase();

  const session = db
    .prepare('SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  // Check if already exists
  if (allowedDirectories.includes(normalizedDir)) {
    return res.json({
      success: true,
      data: allowedDirectories,
      message: 'Directory already allowed',
    });
  }

  // Add the new directory
  allowedDirectories.push(normalizedDir);

  db.prepare(
    'UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(allowedDirectories), req.params.id);

  res.json({ success: true, data: allowedDirectories });
});

// Remove an allowed directory from a session
router.delete('/:id/allowed-directories', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const directory = req.query.directory as string | undefined;

  if (!directory || typeof directory !== 'string') {
    throw new AppError('Directory path is required as query parameter', 400, 'VALIDATION_ERROR');
  }

  const normalizedDir = path.resolve(directory);
  const db = getDatabase();

  const session = db
    .prepare('SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  // Remove the directory
  const newDirectories = allowedDirectories.filter((d) => d !== normalizedDir);

  db.prepare(
    'UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(newDirectories), req.params.id);

  res.json({ success: true, data: newDirectories });
});

// Helper function to validate token from query param or Authorization header
async function validateToken(
  req: import('express').Request,
  res: import('express').Response
): Promise<string | null> {
  const queryToken = req.query.token as string | undefined;
  const authHeader = req.headers.authorization;

  if (queryToken) {
    const jwt = await import('jsonwebtoken');
    try {
      const decoded = jwt.default.verify(queryToken, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res
        .status(401)
        .json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const jwt = await import('jsonwebtoken');
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.default.verify(token, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res
        .status(401)
        .json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else {
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
    });
    return null;
  }
}

// Serve session images (supports token in query param for browser image loading)
router.get('/:id/images/:filename', async (req, res, next) => {
  try {
    const userId = await validateToken(req, res);
    if (!userId) return;

    const db = getDatabase();

    // Verify session ownership and get working directory
    const session = db
      .prepare('SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as { working_directory: string } | undefined;

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res
        .status(400)
        .json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    const imagePath = path.join(session.working_directory, '.claude-webui-images', filename);

    try {
      await fs.access(imagePath);
      res.sendFile(imagePath);
    } catch {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Image not found' } });
    }
  } catch (err) {
    next(err);
  }
});

// Serve session attachments (images, text, pdf, etc.)
router.get('/:id/attachments/:filename', async (req, res, next) => {
  try {
    const userId = await validateToken(req, res);
    if (!userId) return;

    const db = getDatabase();

    // Verify session ownership and get working directory
    const session = db
      .prepare('SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as { working_directory: string } | undefined;

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res
        .status(400)
        .json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    // Try both attachment directories (new and legacy)
    const attachmentPath = path.join(
      session.working_directory,
      '.claude-webui-attachments',
      filename
    );
    const legacyImagePath = path.join(session.working_directory, '.claude-webui-images', filename);

    try {
      await fs.access(attachmentPath);
      res.sendFile(attachmentPath);
    } catch {
      // Try legacy image path
      try {
        await fs.access(legacyImagePath);
        res.sendFile(legacyImagePath);
      } catch {
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
      }
    }
  } catch (err) {
    next(err);
  }
});

// Set session category
router.patch('/:id/category', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { categoryId } = req.body;
  const db = getDatabase();

  // Verify session ownership
  const session = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  // If categoryId is provided, verify it belongs to the user
  if (categoryId) {
    const category = db
      .prepare('SELECT id FROM session_categories WHERE id = ? AND user_id = ?')
      .get(categoryId, userId);

    if (!category) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }
  }

  db.prepare('UPDATE sessions SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    categoryId || null,
    req.params.id
  );

  res.json({ success: true, data: { category: categoryId || null } });
});

// Build an FTS5 MATCH expression that does prefix search on every whitespace-separated
// token. Strips control chars + double-quotes (which are FTS5 phrase delimiters) to
// keep user input from injecting operators. Result example: `hello* world*`.
function buildFtsMatch(query: string): string | null {
  const tokens = query
    .replace(/["'\u0000-\u001f]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`);
  return tokens.length > 0 ? tokens.join(' ') : null;
}

// FTS5 is created by the schema migration but only when the SQLite build supports it.
// Fall back to LIKE so search still works on stripped-down builds.
function ftsAvailable(db: ReturnType<typeof getDatabase>): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'`)
      .get();
    return !!row;
  } catch {
    return false;
  }
}

// Search messages in a session
router.get('/:id/messages/search', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const query = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const db = getDatabase();

  if (!query || query.length < 2) {
    throw new AppError('Query must be at least 2 characters', 400, 'INVALID_QUERY');
  }

  // Verify session ownership
  const session = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const ftsExpr = buildFtsMatch(query);
  const useFts = ftsExpr !== null && ftsAvailable(db);

  const messages = useFts
    ? db
        .prepare(
          `SELECT m.id, m.session_id as sessionId, m.role, m.content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt
           FROM messages_fts f
           JOIN messages m ON m.rowid = f.rowid
           WHERE f.content MATCH ? AND m.session_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(ftsExpr, req.params.id, limit)
    : db
        .prepare(
          `SELECT id, session_id as sessionId, role, content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
           FROM messages
           WHERE session_id = ? AND content LIKE ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`
        )
        .all(req.params.id, `%${query}%`, limit);

  res.json({ success: true, data: messages });
});

// Search all messages across all sessions
router.get('/messages/search', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const query = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const db = getDatabase();

  if (!query || query.length < 2) {
    throw new AppError('Query must be at least 2 characters', 400, 'INVALID_QUERY');
  }

  const ftsExpr = buildFtsMatch(query);
  const useFts = ftsExpr !== null && ftsAvailable(db);

  const messages = useFts
    ? db
        .prepare(
          `SELECT m.id, m.session_id as sessionId, m.role, m.content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt,
                  s.name as sessionName
           FROM messages_fts f
           JOIN messages m ON m.rowid = f.rowid
           JOIN sessions s ON m.session_id = s.id
           WHERE f.content MATCH ? AND s.user_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(ftsExpr, userId, limit)
    : db
        .prepare(
          `SELECT m.id, m.session_id as sessionId, m.role, m.content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt,
                  s.name as sessionName
           FROM messages m
           JOIN sessions s ON m.session_id = s.id
           WHERE s.user_id = ? AND m.content LIKE ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(userId, `%${query}%`, limit);

  res.json({ success: true, data: messages });
});

export default router;
