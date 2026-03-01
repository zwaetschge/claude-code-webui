import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { safeEncrypt, safeDecrypt } from '../utils/encryption';
import { safeJsonParse } from '../utils/json';
import { resolveConfigHome } from '../utils/configPaths';
import type { UserSettings, Theme, UiProvider, CLIProvider } from '@claude-code-webui/shared';

const router = Router();

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultWorkingDir: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  customSystemPrompt: z.string().nullable().optional(),
  uiProvider: z.enum(['plum', 'claude', 'codex', 'zai', 'gemini', 'kimi', 'multi']).optional(),
  defaultCliProvider: z.enum(['claude', 'codex', 'gemini', 'glm', 'kimi', 'multi']).optional(),
  cliProviderModels: z.object({
    claude: z.string().optional(),
    codex: z.string().optional(),
    gemini: z.string().optional(),
    glm: z.string().optional(),
    kimi: z.string().optional(),
  }).partial().optional(),
  cliProviderModelLists: z.object({
    claude: z.array(z.string()).optional(),
    codex: z.array(z.string()).optional(),
    gemini: z.array(z.string()).optional(),
    glm: z.array(z.string()).optional(),
    kimi: z.array(z.string()).optional(),
  }).partial().optional(),
  cliProviderReasoning: z.object({
    claude: z.string().optional(),
    codex: z.string().optional(),
    gemini: z.string().optional(),
    glm: z.string().optional(),
    kimi: z.string().optional(),
  }).partial().optional(),
});

const ZAI_BASE_URL_DEFAULT = 'https://api.z.ai/api/anthropic';

function getSettingsPath(configHome: string): string {
  return path.join(configHome, 'settings.json');
}

async function readClaudeSettings(configHome: string): Promise<Record<string, unknown>> {
  const settingsPath = getSettingsPath(configHome);
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeClaudeSettings(configHome: string, settings: Record<string, unknown>): Promise<void> {
  const settingsPath = getSettingsPath(configHome);
  const dir = path.dirname(settingsPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  try {
    await fs.chmod(settingsPath, 0o600);
  } catch {
    // Ignore permission errors on filesystems without chmod support.
  }
}

async function updateClaudeEnv(configHome: string, updates: Record<string, string | null>): Promise<void> {
  const settings = await readClaudeSettings(configHome);
  const currentEnv = settings.env && typeof settings.env === 'object'
    ? { ...(settings.env as Record<string, string>) }
    : {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      delete currentEnv[key];
    } else {
      currentEnv[key] = value;
    }
  }

  if (Object.keys(currentEnv).length > 0) {
    settings.env = currentEnv;
  } else {
    delete settings.env;
  }

  await writeClaudeSettings(configHome, settings);
}

function parseUiProvider(value: unknown): UiProvider {
  return value === 'plum' || value === 'claude' || value === 'codex' || value === 'zai' || value === 'gemini'
    ? value
    : 'plum';
}

function parseCliProvider(value: unknown): CLIProvider {
  return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'glm' || value === 'kimi'
    ? value
    : 'claude';
}

function parseCliProviderModels(value: unknown): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'gemini', 'glm', 'kimi'];
  for (const provider of providers) {
    const model = raw[provider];
    if (typeof model === 'string' && model.trim()) {
      parsed[provider] = model.trim();
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCliProviderModelLists(value: unknown): Partial<Record<CLIProvider, string[]>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string[]>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'gemini', 'glm', 'kimi'];
  for (const provider of providers) {
    const models = raw[provider];
    if (Array.isArray(models)) {
      const normalized = models
        .map((model) => (typeof model === 'string' ? model.trim() : ''))
        .filter((model) => model.length > 0);
      if (normalized.length > 0) {
        parsed[provider] = normalized;
      }
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

const CODEX_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'extra_high']);

function normalizeReasoningLevel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized) {
    return undefined;
  }

  return CODEX_REASONING_LEVELS.has(normalized) ? normalized : undefined;
}

function parseCliProviderReasoning(value: unknown): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'gemini', 'glm', 'kimi'];
  for (const provider of providers) {
    const level = normalizeReasoningLevel(raw[provider]);
    if (level) {
      parsed[provider] = level;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

// Get user settings
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  let settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt,
              settings_json as settingsJson
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null; settingsJson?: string | null } | undefined;

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
      settingsJson: null,
    };
  }

  const settingsJson = safeJsonParse<Record<string, unknown>>(settings.settingsJson, {});
  const uiProvider = parseUiProvider(settingsJson.uiProvider);
  const defaultCliProvider = parseCliProvider(settingsJson.defaultCliProvider);
  const cliProviderModels = parseCliProviderModels(settingsJson.cliProviderModels);
  const cliProviderModelLists = parseCliProviderModelLists(settingsJson.cliProviderModelLists);
  const cliProviderReasoning = parseCliProviderReasoning(settingsJson.cliProviderReasoning);

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
    uiProvider,
    defaultCliProvider,
    cliProviderModels,
    cliProviderModelLists,
    cliProviderReasoning,
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
  const { theme, defaultWorkingDir, allowedTools, customSystemPrompt, uiProvider, defaultCliProvider, cliProviderModels, cliProviderModelLists, cliProviderReasoning } = parsed.data;

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
  if (uiProvider !== undefined || defaultCliProvider !== undefined || cliProviderModels !== undefined || cliProviderModelLists !== undefined || cliProviderReasoning !== undefined) {
    const existing = db.prepare(
      'SELECT settings_json FROM user_settings WHERE user_id = ?'
    ).get(userId) as { settings_json: string | null } | undefined;

    const settingsJson = safeJsonParse<Record<string, unknown>>(existing?.settings_json, {});
    if (uiProvider !== undefined) {
      settingsJson.uiProvider = uiProvider;
    }
    if (defaultCliProvider !== undefined) {
      settingsJson.defaultCliProvider = defaultCliProvider;
    }
    if (cliProviderModels !== undefined) {
      const normalized = parseCliProviderModels(cliProviderModels) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderModels = normalized;
      } else {
        delete settingsJson.cliProviderModels;
      }
    }
    if (cliProviderModelLists !== undefined) {
      const normalized = parseCliProviderModelLists(cliProviderModelLists) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderModelLists = normalized;
      } else {
        delete settingsJson.cliProviderModelLists;
      }
    }
    if (cliProviderReasoning !== undefined) {
      const normalized = parseCliProviderReasoning(cliProviderReasoning) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderReasoning = normalized;
      } else {
        delete settingsJson.cliProviderReasoning;
      }
    }
    updates.push('settings_json = ?');
    values.push(JSON.stringify(settingsJson));
  }

  if (updates.length > 0) {
    values.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
  }

  // Fetch updated settings
  const settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt,
              settings_json as settingsJson
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null; settingsJson?: string | null };

  const updatedJson = safeJsonParse<Record<string, unknown>>(settings.settingsJson, {});
  const updatedUiProvider = parseUiProvider(updatedJson.uiProvider);
  const updatedDefaultCliProvider = parseCliProvider(updatedJson.defaultCliProvider);
  const updatedCliProviderModels = parseCliProviderModels(updatedJson.cliProviderModels);
  const updatedCliProviderModelLists = parseCliProviderModelLists(updatedJson.cliProviderModelLists);
  const updatedCliProviderReasoning = parseCliProviderReasoning(updatedJson.cliProviderReasoning);

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
    uiProvider: updatedUiProvider,
    defaultCliProvider: updatedDefaultCliProvider,
    cliProviderModels: updatedCliProviderModels,
    cliProviderModelLists: updatedCliProviderModelLists,
    cliProviderReasoning: updatedCliProviderReasoning,
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

  // Encrypt the API key before storing
  const db = getDatabase();
  db.prepare('UPDATE users SET api_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    safeEncrypt(apiKey),
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

  // Encrypt the API key before storing
  settingsObj.geminiApiKey = safeEncrypt(apiKey);

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

// Get Z.AI API key status (not the actual key)
router.get('/zai-key', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();
  const configHome = resolveConfigHome('glm');

  const settingsRow = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(settingsRow?.settings_json, {});
  const encryptedKey = settingsJson.zaiApiKey;
  const apiKey = typeof encryptedKey === 'string' ? safeDecrypt(encryptedKey) : null;

  const claudeSettings = await readClaudeSettings(configHome);
  const env = claudeSettings.env && typeof claudeSettings.env === 'object'
    ? (claudeSettings.env as Record<string, string>)
    : {};

  res.json({
    success: true,
    data: {
      hasKey: !!apiKey,
      keyPreview: apiKey ? `${apiKey.substring(0, 10)}...${apiKey.slice(-4)}` : null,
      baseUrl: env.ANTHROPIC_BASE_URL || null,
    },
  });
}));

// Set Z.AI API key (writes to ~/.claude/settings.json env for Claude Code)
router.put('/zai-key', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey, baseUrl } = req.body as { apiKey?: string; baseUrl?: string };
  const configHome = resolveConfigHome('glm');

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  const db = getDatabase();
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  let settingsObj: Record<string, unknown> = {};
  if (existing?.settings_json) {
    settingsObj = safeJsonParse<Record<string, unknown>>(existing.settings_json, {});
  }

  settingsObj.zaiApiKey = safeEncrypt(apiKey);
  db.prepare(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
  ).run(JSON.stringify(settingsObj), userId);

  const resolvedBaseUrl = typeof baseUrl === 'string' && baseUrl.trim().length > 0
    ? baseUrl.trim()
    : (async () => {
        const claudeSettings = await readClaudeSettings(configHome);
        const env = claudeSettings.env && typeof claudeSettings.env === 'object'
          ? (claudeSettings.env as Record<string, string>)
          : {};
        return env.ANTHROPIC_BASE_URL || ZAI_BASE_URL_DEFAULT;
      })();

  await updateClaudeEnv(configHome, {
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: await resolvedBaseUrl,
  });

  res.json({
    success: true,
    data: {
      hasKey: true,
      keyPreview: `${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`,
      baseUrl: await resolvedBaseUrl,
    },
  });
}));

// Delete Z.AI API key
router.delete('/zai-key', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();
  const configHome = resolveConfigHome('glm');

  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    const settingsObj = safeJsonParse<Record<string, unknown>>(existing.settings_json, {});
    delete settingsObj.zaiApiKey;
    db.prepare(
      'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
    ).run(JSON.stringify(settingsObj), userId);
  }

  const claudeSettings = await readClaudeSettings(configHome);
  const env = claudeSettings.env && typeof claudeSettings.env === 'object'
    ? (claudeSettings.env as Record<string, string>)
    : {};
  const shouldRemoveBaseUrl = !env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL.includes('api.z.ai');

  await updateClaudeEnv(configHome, {
    ANTHROPIC_AUTH_TOKEN: null,
    ANTHROPIC_BASE_URL: shouldRemoveBaseUrl ? null : (env.ANTHROPIC_BASE_URL ?? null),
  });

  res.json({ success: true });
}));

// Get Gemini API key for internal use (returns full decrypted key)
export function getGeminiApiKeyForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedKey = parsed.geminiApiKey;
    if (typeof encryptedKey === 'string') {
      return safeDecrypt(encryptedKey);
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

  // Encrypt the token before storing
  settingsObj.githubToken = safeEncrypt(token);

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

// Get GitHub token for internal use (returns full decrypted token)
export function getGitHubTokenForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedToken = parsed.githubToken;
    if (typeof encryptedToken === 'string') {
      return safeDecrypt(encryptedToken);
    }
  }

  return null;
}

// Get Mistral API key status (not the actual key)
router.get('/mistral-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedKey = parsed.mistralApiKey;
    if (typeof encryptedKey === 'string') {
      const apiKey = safeDecrypt(encryptedKey);
      res.json({
        success: true,
        data: {
          hasKey: !!apiKey,
          keyPreview: apiKey ? `${apiKey.substring(0, 8)}...${apiKey.slice(-4)}` : null
        }
      });
      return;
    }
  }

  res.json({ success: true, data: { hasKey: false, keyPreview: null } });
});

// Set Mistral API key
router.put('/mistral-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey } = req.body;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  const settingsObj = safeJsonParse<Record<string, unknown>>(existing?.settings_json, {});

  // Encrypt the API key before storing
  settingsObj.mistralApiKey = safeEncrypt(apiKey);

  db.prepare(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
  ).run(JSON.stringify(settingsObj), userId);

  res.json({
    success: true,
    data: {
      hasKey: true,
      keyPreview: `${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`
    }
  });
});

// Delete Mistral API key
router.delete('/mistral-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Get existing settings_json
  const existing = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    const settingsObj = safeJsonParse<Record<string, unknown>>(existing.settings_json, {});
    delete settingsObj.mistralApiKey;

    db.prepare(
      'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
    ).run(JSON.stringify(settingsObj), userId);
  }

  res.json({ success: true });
});

// Get Mistral API key for internal use (returns full decrypted key)
export function getMistralApiKeyForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedKey = parsed.mistralApiKey;
    if (typeof encryptedKey === 'string') {
      return safeDecrypt(encryptedKey);
    }
  }

  return null;
}

export default router;
