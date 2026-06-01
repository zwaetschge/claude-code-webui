import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import type { ApiResponse } from '@claude-code-webui/shared';

const router = Router();

const NOTE_TITLE_MAX = 200;
const NOTE_CONTENT_MAX = 64_000;

const createNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_MAX).optional(),
  content: z.string().max(NOTE_CONTENT_MAX).optional(),
  sessionId: z.string().min(1).max(128).nullish(),
  pinned: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_MAX).optional(),
  content: z.string().max(NOTE_CONTENT_MAX).optional(),
  sessionId: z.string().min(1).max(128).nullish(),
  pinned: z.boolean().optional(),
});

function userOwnsSession(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  userId: string
): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sessions WHERE id = ? AND user_id = ?`)
    .get(sessionId, userId) as { ok: number } | undefined;
  return !!row;
}

interface Note {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  content: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

// Get all notes for user
router.get('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();

  try {
    const notes = db
      .prepare(
        `SELECT id, user_id, session_id, title, content, pinned, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC`
      )
      .all(authReq.userId) as Note[];

    const response: ApiResponse<Note[]> = {
      success: true,
      data: notes,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch notes' },
    };
    res.status(500).json(response);
  }
});

// Get notes for a specific session
router.get('/session/:sessionId', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { sessionId } = req.params;

  try {
    const notes = db
      .prepare(
        `SELECT id, user_id, session_id, title, content, pinned, created_at, updated_at FROM notes WHERE user_id = ? AND session_id = ? ORDER BY pinned DESC, updated_at DESC`
      )
      .all(authReq.userId, sessionId) as Note[];

    const response: ApiResponse<Note[]> = {
      success: true,
      data: notes,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch session notes' },
    };
    res.status(500).json(response);
  }
});

// Create a new note
router.post('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();

  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid request',
      },
    };
    return res.status(400).json(response);
  }
  const { title, content, sessionId, pinned } = parsed.data;

  if (sessionId && !userOwnsSession(db, sessionId, authReq.userId)) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Session not found or access denied' },
    };
    return res.status(403).json(response);
  }

  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO notes (id, user_id, session_id, title, content, pinned) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      authReq.userId,
      sessionId || null,
      title || 'Untitled',
      content || '',
      pinned ? 1 : 0
    );

    const note = db
      .prepare(
        `SELECT id, user_id, session_id, title, content, pinned, created_at, updated_at FROM notes WHERE id = ?`
      )
      .get(id) as Note;

    const response: ApiResponse<Note> = {
      success: true,
      data: note,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create note' },
    };
    res.status(500).json(response);
  }
});

// Update a note
router.patch('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid request',
      },
    };
    return res.status(400).json(response);
  }
  const { title, content, pinned, sessionId } = parsed.data;

  try {
    // Check ownership
    const existing = db
      .prepare(
        `SELECT id, user_id, session_id, title, content, pinned, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?`
      )
      .get(id, authReq.userId) as Note | undefined;

    if (!existing) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Note not found' },
      };
      return res.status(404).json(response);
    }

    if (sessionId && !userOwnsSession(db, sessionId, authReq.userId)) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Session not found or access denied' },
      };
      return res.status(403).json(response);
    }

    // Build update query
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: (string | number | null)[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      values.push(content);
    }
    if (pinned !== undefined) {
      updates.push('pinned = ?');
      values.push(pinned ? 1 : 0);
    }
    if (sessionId !== undefined) {
      updates.push('session_id = ?');
      values.push(sessionId ?? null);
    }

    values.push(id as string);
    db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const note = db
      .prepare(
        `SELECT id, user_id, session_id, title, content, pinned, created_at, updated_at FROM notes WHERE id = ?`
      )
      .get(id) as Note;

    const response: ApiResponse<Note> = {
      success: true,
      data: note,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update note' },
    };
    res.status(500).json(response);
  }
});

// Delete a note
router.delete('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  try {
    const result = db
      .prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`)
      .run(id, authReq.userId);

    if (result.changes === 0) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Note not found' },
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse<{ deleted: boolean }> = {
      success: true,
      data: { deleted: true },
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete note' },
    };
    res.status(500).json(response);
  }
});

export default router;
