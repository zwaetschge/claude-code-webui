import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { safeJsonParse } from '../utils/json';
import { rateLimiters } from '../middleware/rateLimiter';

const router = Router();

// Validation schemas
const createSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workingDirectory: z.string().optional(), // Optional - will be auto-generated from name
});

const updateSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workingDirectory: z.string().min(1).optional(),
});

// Validate working directory
function validateWorkingDirectory(dir: string): boolean {
  const resolvedPath = path.resolve(dir);
  return config.allowedBasePaths.some((base) => resolvedPath.startsWith(base));
}

// Sanitize session name for folder creation
function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => {
      const map: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
      return map[char] || char;
    })
    .replace(/[^a-z0-9-_]/g, '-')  // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-')            // Collapse multiple hyphens
    .replace(/^-|-$/g, '')          // Remove leading/trailing hyphens
    .substring(0, 100);             // Limit length
}

// Ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// List all sessions
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const sessions = db
    .prepare(
      `SELECT id, user_id as userId, name, working_directory as workingDirectory,
              claude_session_id as claudeSessionId, status, last_message as lastMessage,
              starred, category, created_at as createdAt, updated_at as updatedAt
       FROM sessions WHERE user_id = ? ORDER BY starred DESC, updated_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const sessionsWithStarred = sessions.map((s) => ({ ...s, starred: Boolean(s.starred) }));

  res.json({ success: true, data: sessionsWithStarred });
});

// Get session by ID
router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const rawSession = db
    .prepare(
      `SELECT id, user_id as userId, name, working_directory as workingDirectory,
              claude_session_id as claudeSessionId, status, last_message as lastMessage,
              starred, category, created_at as createdAt, updated_at as updatedAt
       FROM sessions WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  const session = rawSession ? { ...rawSession, starred: Boolean(rawSession.starred) } : null;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: session });
});

// Create new session (with rate limiting)
router.post('/', requireAuth, rateLimiters.sessionCreation, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createSessionSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { name, workingDirectory: providedWorkingDir } = parsed.data;
  const db = getDatabase();

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
      .prepare('SELECT default_working_dir as defaultWorkingDir FROM user_settings WHERE user_id = ?')
      .get(userId) as { defaultWorkingDir: string | null } | undefined;

    const defaultWorkingDir = settings?.defaultWorkingDir;

    if (!defaultWorkingDir) {
      throw new AppError('Please set a default working directory in Settings first', 400, 'NO_DEFAULT_DIR');
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

  const sessionId = nanoid();

  db.prepare(
    `INSERT INTO sessions (id, user_id, name, working_directory)
     VALUES (?, ?, ?, ?)`
  ).run(sessionId, userId, name, workingDirectory);

  const newSession = db
    .prepare(
      `SELECT id, user_id as userId, name, working_directory as workingDirectory,
              claude_session_id as claudeSessionId, status, last_message as lastMessage,
              starred, created_at as createdAt, updated_at as updatedAt
       FROM sessions WHERE id = ?`
    )
    .get(sessionId) as Record<string, unknown>;

  res.status(201).json({ success: true, data: { ...newSession, starred: Boolean(newSession.starred) } });
});

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

  if (workingDirectory && !validateWorkingDirectory(workingDirectory)) {
    throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }
  if (workingDirectory) {
    updates.push('working_directory = ?');
    values.push(workingDirectory);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);
    db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updatedSession = db
    .prepare(
      `SELECT id, user_id as userId, name, working_directory as workingDirectory,
              claude_session_id as claudeSessionId, status, last_message as lastMessage,
              starred, created_at as createdAt, updated_at as updatedAt
       FROM sessions WHERE id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ success: true, data: { ...updatedSession, starred: Boolean(updatedSession.starred) } });
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
  db.prepare('UPDATE sessions SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStarred, req.params.id);

  res.json({ success: true, data: { starred: Boolean(newStarred) } });
});

// Delete session
router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);

  if (result.changes === 0) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Get session messages
router.get('/:id/messages', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Verify session ownership
  const session = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const messages = db
    .prepare(
      `SELECT id, session_id as sessionId, role, content, created_at as createdAt
       FROM messages WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(req.params.id);

  res.json({ success: true, data: messages });
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
    return res.json({ success: true, data: allowedDirectories, message: 'Directory already allowed' });
  }

  // Add the new directory
  allowedDirectories.push(normalizedDir);

  db.prepare('UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(allowedDirectories), req.params.id);

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

  db.prepare('UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(newDirectories), req.params.id);

  res.json({ success: true, data: newDirectories });
});

// Helper function to validate token from query param or Authorization header
async function validateToken(req: import('express').Request, res: import('express').Response): Promise<string | null> {
  const queryToken = req.query.token as string | undefined;
  const authHeader = req.headers.authorization;

  if (queryToken) {
    const jwt = await import('jsonwebtoken');
    try {
      const decoded = jwt.default.verify(queryToken, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const jwt = await import('jsonwebtoken');
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.default.verify(token, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else {
    res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
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
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    const imagePath = path.join(session.working_directory, '.claude-webui-images', filename);

    try {
      await fs.access(imagePath);
      res.sendFile(imagePath);
    } catch {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Image not found' } });
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
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    // Try both attachment directories (new and legacy)
    const attachmentPath = path.join(session.working_directory, '.claude-webui-attachments', filename);
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
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
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

  db.prepare('UPDATE sessions SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(categoryId || null, req.params.id);

  res.json({ success: true, data: { category: categoryId || null } });
});

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

  // Search messages with LIKE
  const searchPattern = `%${query}%`;
  const messages = db
    .prepare(
      `SELECT id, session_id as sessionId, role, content, created_at as createdAt
       FROM messages
       WHERE session_id = ? AND content LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(req.params.id, searchPattern, limit);

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

  // Search messages with LIKE, joining with sessions to verify ownership
  const searchPattern = `%${query}%`;
  const messages = db
    .prepare(
      `SELECT m.id, m.session_id as sessionId, m.role, m.content, m.created_at as createdAt,
              s.name as sessionName
       FROM messages m
       JOIN sessions s ON m.session_id = s.id
       WHERE s.user_id = ? AND m.content LIKE ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .all(userId, searchPattern, limit);

  res.json({ success: true, data: messages });
});

export default router;
