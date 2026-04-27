import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import type { ApiResponse } from '@claude-code-webui/shared';

const router = Router();

interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

// Get all categories for user
router.get('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();

  try {
    const categories = db
      .prepare(
        `SELECT id, user_id, name, color, icon, sort_order, created_at FROM session_categories WHERE user_id = ? ORDER BY sort_order ASC, name ASC`
      )
      .all(authReq.userId) as Category[];

    const response: ApiResponse<Category[]> = {
      success: true,
      data: categories,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch categories' },
    };
    res.status(500).json(response);
  }
});

// Create a new category
router.post('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { name, color, icon } = req.body;

  if (!name) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
    };
    return res.status(400).json(response);
  }

  try {
    const id = nanoid();

    // Get max sort_order
    const maxOrder = db
      .prepare(`SELECT MAX(sort_order) as max FROM session_categories WHERE user_id = ?`)
      .get(authReq.userId) as { max: number | null };

    db.prepare(
      `INSERT INTO session_categories (id, user_id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, authReq.userId, name, color || 'blue', icon || 'folder', (maxOrder.max || 0) + 1);

    const category = db.prepare(`SELECT id, user_id, name, color, icon, sort_order, created_at FROM session_categories WHERE id = ?`).get(id) as Category;

    const response: ApiResponse<Category> = {
      success: true,
      data: category,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create category' },
    };
    res.status(500).json(response);
  }
});

// Update a category
router.patch('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;
  const { name, color, icon, sort_order } = req.body;

  try {
    // Check ownership
    const existing = db
      .prepare(`SELECT id, user_id, name, color, icon, sort_order, created_at FROM session_categories WHERE id = ? AND user_id = ?`)
      .get(id, authReq.userId) as Category | undefined;

    if (!existing) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Category not found' },
      };
      return res.status(404).json(response);
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(sort_order);
    }

    if (updates.length > 0) {
      values.push(id as string);
      db.prepare(`UPDATE session_categories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const category = db.prepare(`SELECT id, user_id, name, color, icon, sort_order, created_at FROM session_categories WHERE id = ?`).get(id) as Category;

    const response: ApiResponse<Category> = {
      success: true,
      data: category,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update category' },
    };
    res.status(500).json(response);
  }
});

// Delete a category
router.delete('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  try {
    // Remove category from sessions first
    db.prepare(`UPDATE sessions SET category = NULL WHERE category = ? AND user_id = ?`)
      .run(id, authReq.userId);

    const result = db
      .prepare(`DELETE FROM session_categories WHERE id = ? AND user_id = ?`)
      .run(id, authReq.userId);

    if (result.changes === 0) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Category not found' },
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
      error: { code: 'DELETE_ERROR', message: 'Failed to delete category' },
    };
    res.status(500).json(response);
  }
});

// Reorder categories
router.post('/reorder', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { categoryIds } = req.body as { categoryIds: string[] };

  if (!Array.isArray(categoryIds)) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'categoryIds must be an array' },
    };
    return res.status(400).json(response);
  }

  try {
    const updateStmt = db.prepare(`UPDATE session_categories SET sort_order = ? WHERE id = ? AND user_id = ?`);

    categoryIds.forEach((categoryId, index) => {
      updateStmt.run(index, categoryId, authReq.userId);
    });

    const categories = db
      .prepare(`SELECT id, user_id, name, color, icon, sort_order, created_at FROM session_categories WHERE user_id = ? ORDER BY sort_order ASC`)
      .all(authReq.userId) as Category[];

    const response: ApiResponse<Category[]> = {
      success: true,
      data: categories,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'REORDER_ERROR', message: 'Failed to reorder categories' },
    };
    res.status(500).json(response);
  }
});

export default router;
