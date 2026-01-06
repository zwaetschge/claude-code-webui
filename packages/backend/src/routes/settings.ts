import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError } from '../middleware/errorHandler';
import type { UserSettings, Theme } from '@claude-code-webui/shared';

const router = Router();

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultWorkingDir: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  customSystemPrompt: z.string().nullable().optional(),
});

// Get user settings
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  let settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null } | undefined;

  if (!settings) {
    // Create default settings
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, allowed_tools)
       VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
    ).run(userId);

    settings = {
      userId,
      theme: 'dark',
      defaultWorkingDir: null,
      allowedTools: '["Bash","Read","Write","Edit","Glob","Grep"]',
      customSystemPrompt: null,
    };
  }

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
  };

  res.json({ success: true, data: userSettings });
});

// Update user settings
router.put('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const { theme, defaultWorkingDir, allowedTools, customSystemPrompt } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (theme !== undefined) {
    updates.push('theme = ?');
    values.push(theme);
  }
  if (defaultWorkingDir !== undefined) {
    updates.push('default_working_dir = ?');
    values.push(defaultWorkingDir);
  }
  if (allowedTools !== undefined) {
    updates.push('allowed_tools = ?');
    values.push(JSON.stringify(allowedTools));
  }
  if (customSystemPrompt !== undefined) {
    updates.push('custom_system_prompt = ?');
    values.push(customSystemPrompt);
  }

  if (updates.length > 0) {
    values.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
  }

  // Fetch updated settings
  const settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null };

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
  };

  res.json({ success: true, data: userSettings });
});

// Update API key
router.put('/api-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey } = req.body;

  if (!apiKey) {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  // TODO: Encrypt the API key before storing
  // For now, store as-is (in production, use proper encryption)
  const db = getDatabase();
  db.prepare('UPDATE users SET api_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    apiKey,
    userId
  );

  res.json({ success: true });
});

// Delete API key
router.delete('/api-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  db.prepare('UPDATE users SET api_key_encrypted = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    userId
  );

  res.json({ success: true });
});

// Get Gemini API key status (not the actual key)
router.get('/gemini-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      res.json({
        success: true,
        data: {
          hasKey: !!parsed.geminiApiKey,
          keyPreview: parsed.geminiApiKey
            ? `${parsed.geminiApiKey.substring(0, 10)}...${parsed.geminiApiKey.slice(-4)}`
            : null
        }
      });
      return;
    } catch {
      // Invalid JSON, continue
    }
  }

  res.json({ success: true, data: { hasKey: false, keyPreview: null } });
});

// Set Gemini API key
router.put('/gemini-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey } = req.body;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  // Validate key format (Google API keys start with AIza)
  if (!apiKey.startsWith('AIza')) {
    throw new AppError('Invalid Gemini API key format', 400, 'INVALID_API_KEY');
  }

  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  let settingsObj: Record<string, unknown> = {};
  if (existing?.settings_json) {
    try {
      settingsObj = JSON.parse(existing.settings_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  settingsObj.geminiApiKey = apiKey;

  db.prepare(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
  ).run(JSON.stringify(settingsObj), userId);

  res.json({
    success: true,
    data: {
      hasKey: true,
      keyPreview: `${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`
    }
  });
});

// Delete Gemini API key
router.delete('/gemini-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    try {
      const settingsObj = JSON.parse(existing.settings_json);
      delete settingsObj.geminiApiKey;

      db.prepare(
        'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
      ).run(JSON.stringify(settingsObj), userId);
    } catch {
      // Invalid JSON, just continue
    }
  }

  res.json({ success: true });
});

// Get Gemini API key for internal use (returns full key)
export function getGeminiApiKeyForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      return parsed.geminiApiKey || null;
    } catch {
      return null;
    }
  }

  return null;
}

// Get GitHub token status (not the actual token)
router.get('/github-token', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      if (parsed.githubToken) {
        res.json({
          success: true,
          data: {
            hasToken: true,
            tokenPreview: `${parsed.githubToken.substring(0, 8)}...${parsed.githubToken.slice(-4)}`
          }
        });
        return;
      }
    } catch {
      // Invalid JSON, continue
    }
  }

  res.json({ success: true, data: { hasToken: false, tokenPreview: null } });
});

// Set GitHub token
router.put('/github-token', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    throw new AppError('Token is required', 400, 'MISSING_TOKEN');
  }

  // Validate token format (GitHub PAT starts with ghp_, github_pat_, or is a classic token)
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_') && token.length < 20) {
    throw new AppError('Invalid GitHub token format', 400, 'INVALID_TOKEN');
  }

  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  let settingsObj: Record<string, unknown> = {};
  if (existing?.settings_json) {
    try {
      settingsObj = JSON.parse(existing.settings_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  settingsObj.githubToken = token;

  db.prepare(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
  ).run(JSON.stringify(settingsObj), userId);

  res.json({
    success: true,
    data: {
      hasToken: true,
      tokenPreview: `${token.substring(0, 8)}...${token.slice(-4)}`
    }
  });
});

// Delete GitHub token
router.delete('/github-token', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    try {
      const settingsObj = JSON.parse(existing.settings_json);
      delete settingsObj.githubToken;

      db.prepare(
        'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
      ).run(JSON.stringify(settingsObj), userId);
    } catch {
      // Invalid JSON, just continue
    }
  }

  res.json({ success: true });
});

// Get GitHub token for internal use (returns full token)
export function getGitHubTokenForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      return parsed.githubToken || null;
    } catch {
      return null;
    }
  }

  return null;
}

export default router;
