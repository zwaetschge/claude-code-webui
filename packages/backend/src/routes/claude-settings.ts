/**
 * Claude Settings Management
 *
 * Manages Claude's settings files for permission patterns:
 * - ~/.claude/settings.json - Global user settings
 * - .claude/settings.local.json - Project-specific settings
 *
 * Settings file format:
 * {
 *   "permissions": {
 *     "allow": ["Bash(git:*)", "Read(/src/:*)"],
 *     "deny": []
 *   }
 * }
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getDatabase } from '../db';

const router = Router();

// Types
interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
}

// Validation schemas
const addPatternSchema = z.object({
  pattern: z.string().min(1),
  type: z.enum(['allow', 'deny']).default('allow'),
  scope: z.enum(['project', 'global']),
  projectPath: z.string().optional(), // Required for project scope
});

const removePatternSchema = z.object({
  pattern: z.string().min(1),
  type: z.enum(['allow', 'deny']).default('allow'),
  scope: z.enum(['project', 'global']),
  projectPath: z.string().optional(),
});

// Helper to ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

// Helper to read a settings file
async function readSettingsFile(filePath: string): Promise<ClaudeSettings> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    // File doesn't exist or invalid JSON
    return {};
  }
}

// Helper to write a settings file
async function writeSettingsFile(filePath: string, settings: ClaudeSettings): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

// Get global settings file path
function getGlobalSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// Get project settings file path
function getProjectSettingsPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'settings.local.json');
}

// Get working directory for a session
async function getSessionWorkingDirectory(sessionId: string, userId: string): Promise<string | null> {
  const db = getDatabase();
  const session = db
    .prepare('SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as { working_directory: string } | undefined;

  return session?.working_directory || null;
}

/**
 * GET /api/claude-settings/global
 * Get global Claude settings
 */
router.get('/global', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const settingsPath = getGlobalSettingsPath();
  const settings = await readSettingsFile(settingsPath);

  res.json({
    success: true,
    data: {
      path: settingsPath,
      settings,
      allowPatterns: settings.permissions?.allow || [],
      denyPatterns: settings.permissions?.deny || [],
    },
  });
}));

/**
 * GET /api/claude-settings/project/:sessionId
 * Get project-specific Claude settings for a session
 */
router.get('/project/:sessionId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    throw new AppError('Missing sessionId', 400, 'VALIDATION_ERROR');
  }

  const workingDirectory = await getSessionWorkingDirectory(sessionId, userId);

  if (!workingDirectory) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const settingsPath = getProjectSettingsPath(workingDirectory);
  const settings = await readSettingsFile(settingsPath);

  res.json({
    success: true,
    data: {
      path: settingsPath,
      projectPath: workingDirectory,
      settings,
      allowPatterns: settings.permissions?.allow || [],
      denyPatterns: settings.permissions?.deny || [],
    },
  });
}));

/**
 * POST /api/claude-settings/add-pattern
 * Add a permission pattern to settings
 */
router.post('/add-pattern', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = addPatternSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { pattern, type, scope, projectPath } = parsed.data;

  let settingsPath: string;
  let actualProjectPath: string | undefined;

  if (scope === 'global') {
    settingsPath = getGlobalSettingsPath();
  } else {
    // For project scope, we need the project path
    if (!projectPath) {
      throw new AppError('Project path is required for project scope', 400, 'MISSING_PROJECT_PATH');
    }

    actualProjectPath = projectPath;
    settingsPath = getProjectSettingsPath(projectPath);
  }

  // Read existing settings
  const settings = await readSettingsFile(settingsPath);

  // Initialize permissions if needed
  if (!settings.permissions) {
    settings.permissions = {};
  }

  const listKey = type === 'allow' ? 'allow' : 'deny';
  if (!settings.permissions[listKey]) {
    settings.permissions[listKey] = [];
  }

  // Add pattern if not already present
  const patterns = settings.permissions[listKey]!;
  if (!patterns.includes(pattern)) {
    patterns.push(pattern);
  }

  // Write updated settings
  await writeSettingsFile(settingsPath, settings);

  console.log(`[CLAUDE-SETTINGS] Added ${type} pattern "${pattern}" to ${scope} settings`);

  res.json({
    success: true,
    data: {
      pattern,
      type,
      scope,
      path: settingsPath,
      projectPath: actualProjectPath,
      patterns: patterns,
    },
  });
}));

/**
 * POST /api/claude-settings/remove-pattern
 * Remove a permission pattern from settings
 */
router.post('/remove-pattern', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = removePatternSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { pattern, type, scope, projectPath } = parsed.data;

  let settingsPath: string;

  if (scope === 'global') {
    settingsPath = getGlobalSettingsPath();
  } else {
    if (!projectPath) {
      throw new AppError('Project path is required for project scope', 400, 'MISSING_PROJECT_PATH');
    }
    settingsPath = getProjectSettingsPath(projectPath);
  }

  // Read existing settings
  const settings = await readSettingsFile(settingsPath);

  const listKey = type === 'allow' ? 'allow' : 'deny';
  const patterns = settings.permissions?.[listKey];

  if (patterns) {
    const index = patterns.indexOf(pattern);
    if (index !== -1) {
      patterns.splice(index, 1);
      await writeSettingsFile(settingsPath, settings);
      console.log(`[CLAUDE-SETTINGS] Removed ${type} pattern "${pattern}" from ${scope} settings`);
    }
  }

  res.json({
    success: true,
    data: {
      pattern,
      type,
      scope,
      path: settingsPath,
      patterns: patterns || [],
    },
  });
}));

/**
 * Helper function to add a pattern (used by permissions route)
 */
export async function addPatternToSettings(
  pattern: string,
  scope: 'project' | 'global',
  projectPath?: string
): Promise<void> {
  let settingsPath: string;

  if (scope === 'global') {
    settingsPath = getGlobalSettingsPath();
  } else {
    if (!projectPath) {
      throw new Error('Project path is required for project scope');
    }
    settingsPath = getProjectSettingsPath(projectPath);
  }

  const settings = await readSettingsFile(settingsPath);

  if (!settings.permissions) {
    settings.permissions = {};
  }
  if (!settings.permissions.allow) {
    settings.permissions.allow = [];
  }

  if (!settings.permissions.allow.includes(pattern)) {
    settings.permissions.allow.push(pattern);
    await writeSettingsFile(settingsPath, settings);
    console.log(`[CLAUDE-SETTINGS] Added allow pattern "${pattern}" to ${scope} settings`);
  }
}

export default router;
