import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getAppConfig, getDatabase, setAppConfig } from '../db';
import { AppError } from '../middleware/errorHandler';
import { safeEncrypt, safeDecrypt } from '../utils/encryption';
import { safeJsonParse } from '../utils/json';
import type {
  UserSettings,
  Theme,
  UiProvider,
  CLIProvider,
  CodexWebSearchMode,
  CodexServiceTier,
  LocalUsageBudget,
} from '@claude-code-webui/shared';

const router = Router();

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultWorkingDir: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  customSystemPrompt: z.string().nullable().optional(),
  uiProvider: z.enum(['plum', 'claude', 'codex', 'opencode', 'vibe']).optional(),
  defaultCliProvider: z.enum(['claude', 'codex', 'opencode', 'vibe']).optional(),
  cliProviderModels: z
    .object({
      claude: z.string().optional(),
      codex: z.string().optional(),
      opencode: z.string().optional(),
      vibe: z.string().optional(),
    })
    .partial()
    .optional(),
  cliProviderModelLists: z
    .object({
      claude: z.array(z.string()).optional(),
      codex: z.array(z.string()).optional(),
      opencode: z.array(z.string()).optional(),
      vibe: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
  cliProviderReasoning: z
    .object({
      claude: z.string().optional(),
      codex: z.string().optional(),
      opencode: z.string().optional(),
      vibe: z.string().optional(),
    })
    .partial()
    .optional(),
  cliProviderServiceTiers: z
    .object({
      codex: z.enum(['fast']).optional(),
    })
    .partial()
    .optional(),
  codexWebSearch: z.enum(['auto', 'cached', 'live', 'disabled']).optional(),
  localUsageBudgets: z
    .object({
      claude: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      codex: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      opencode: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      vibe: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});

function parseUiProvider(value: unknown): UiProvider {
  return value === 'plum' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'vibe'
    ? value
    : 'plum';
}

function parseCliProvider(value: unknown): CLIProvider {
  return value === 'claude' || value === 'codex' || value === 'opencode' || value === 'vibe'
    ? value
    : 'codex';
}

function parseCodexWebSearch(value: unknown): CodexWebSearchMode {
  return value === 'cached' || value === 'live' || value === 'disabled' || value === 'auto'
    ? value
    : 'auto';
}

function parseCliProviderModels(value: unknown): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'opencode', 'vibe'];
  for (const provider of providers) {
    const model = raw[provider];
    if (typeof model === 'string' && model.trim()) {
      parsed[provider] = model.trim();
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCliProviderModelLists(
  value: unknown
): Partial<Record<CLIProvider, string[]>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string[]>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'opencode', 'vibe'];
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

const VALID_REASONING_LEVELS = new Set([
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'extra_high',
  'xhigh',
  'max',
]);

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

  return VALID_REASONING_LEVELS.has(normalized) ? normalized : undefined;
}

function parseCliProviderReasoning(
  value: unknown
): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = ['claude', 'codex', 'opencode', 'vibe'];
  for (const provider of providers) {
    const level = normalizeReasoningLevel(raw[provider]);
    if (level) {
      parsed[provider] = level;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeCodexServiceTier(value: unknown): CodexServiceTier | undefined {
  return value === 'fast' ? 'fast' : undefined;
}

function parseCliProviderServiceTiers(
  value: unknown
): Partial<Record<CLIProvider, CodexServiceTier>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, CodexServiceTier>> = {};
  const codexTier = normalizeCodexServiceTier(raw.codex);
  if (codexTier) {
    parsed.codex = codexTier;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeBudgetNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

function parseLocalUsageBudgets(
  value: unknown
): Partial<Record<CLIProvider, LocalUsageBudget>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, LocalUsageBudget>> = {};
  const providers: CLIProvider[] = ['claude', 'codex', 'opencode', 'vibe'];

  for (const provider of providers) {
    const entry = raw[provider];
    if (!entry || typeof entry !== 'object') continue;
    const budget = entry as Record<string, unknown>;
    const dailyUsd = normalizeBudgetNumber(budget.dailyUsd);
    const weeklyUsd = normalizeBudgetNumber(budget.weeklyUsd);
    if (dailyUsd || weeklyUsd) {
      parsed[provider] = { ...(dailyUsd ? { dailyUsd } : {}), ...(weeklyUsd ? { weeklyUsd } : {}) };
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
    .get(userId) as
    | {
        userId: string;
        theme: Theme;
        defaultWorkingDir: string | null;
        allowedTools: string;
        customSystemPrompt: string | null;
        settingsJson?: string | null;
      }
    | undefined;

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
  const cliProviderServiceTiers = parseCliProviderServiceTiers(
    settingsJson.cliProviderServiceTiers
  );
  const codexWebSearch = parseCodexWebSearch(settingsJson.codexWebSearch);
  const localUsageBudgets = parseLocalUsageBudgets(settingsJson.localUsageBudgets);

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
    cliProviderServiceTiers,
    codexWebSearch,
    localUsageBudgets,
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
  const {
    theme,
    defaultWorkingDir,
    allowedTools,
    customSystemPrompt,
    uiProvider,
    defaultCliProvider,
    cliProviderModels,
    cliProviderModelLists,
    cliProviderReasoning,
    cliProviderServiceTiers,
    codexWebSearch,
    localUsageBudgets,
  } = parsed.data;

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
  if (
    uiProvider !== undefined ||
    defaultCliProvider !== undefined ||
    cliProviderModels !== undefined ||
    cliProviderModelLists !== undefined ||
    cliProviderReasoning !== undefined ||
    cliProviderServiceTiers !== undefined ||
    codexWebSearch !== undefined ||
    localUsageBudgets !== undefined
  ) {
    const existing = db
      .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
      .get(userId) as { settings_json: string | null } | undefined;

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
    if (cliProviderServiceTiers !== undefined) {
      const normalized = parseCliProviderServiceTiers(cliProviderServiceTiers) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderServiceTiers = normalized;
      } else {
        delete settingsJson.cliProviderServiceTiers;
      }
    }
    if (codexWebSearch !== undefined) {
      settingsJson.codexWebSearch = parseCodexWebSearch(codexWebSearch);
    }
    if (localUsageBudgets !== undefined) {
      const normalized = parseLocalUsageBudgets(localUsageBudgets) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.localUsageBudgets = normalized;
      } else {
        delete settingsJson.localUsageBudgets;
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
    .get(userId) as {
    userId: string;
    theme: Theme;
    defaultWorkingDir: string | null;
    allowedTools: string;
    customSystemPrompt: string | null;
    settingsJson?: string | null;
  };

  const updatedJson = safeJsonParse<Record<string, unknown>>(settings.settingsJson, {});
  const updatedUiProvider = parseUiProvider(updatedJson.uiProvider);
  const updatedDefaultCliProvider = parseCliProvider(updatedJson.defaultCliProvider);
  const updatedCliProviderModels = parseCliProviderModels(updatedJson.cliProviderModels);
  const updatedCliProviderModelLists = parseCliProviderModelLists(
    updatedJson.cliProviderModelLists
  );
  const updatedCliProviderReasoning = parseCliProviderReasoning(updatedJson.cliProviderReasoning);
  const updatedCliProviderServiceTiers = parseCliProviderServiceTiers(
    updatedJson.cliProviderServiceTiers
  );
  const updatedCodexWebSearch = parseCodexWebSearch(updatedJson.codexWebSearch);
  const updatedLocalUsageBudgets = parseLocalUsageBudgets(updatedJson.localUsageBudgets);

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
    cliProviderServiceTiers: updatedCliProviderServiceTiers,
    codexWebSearch: updatedCodexWebSearch,
    localUsageBudgets: updatedLocalUsageBudgets,
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
  db.prepare(
    'UPDATE users SET api_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(safeEncrypt(apiKey), userId);

  res.json({ success: true });
});

// Delete API key
router.delete('/api-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  db.prepare(
    'UPDATE users SET api_key_encrypted = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(userId);

  res.json({ success: true });
});

// Get GitHub token status (not the actual token)
router.get('/github-token', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const settings = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      if (parsed.githubToken) {
        res.json({
          success: true,
          data: {
            hasToken: true,
            tokenPreview: `${parsed.githubToken.substring(0, 8)}...${parsed.githubToken.slice(-4)}`,
          },
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
  const existing = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

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

  db.prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?').run(
    JSON.stringify(settingsObj),
    userId
  );

  res.json({
    success: true,
    data: {
      hasToken: true,
      tokenPreview: `${token.substring(0, 8)}...${token.slice(-4)}`,
    },
  });
});

// Delete GitHub token
router.delete('/github-token', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Get existing settings_json
  const existing = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    try {
      const settingsObj = JSON.parse(existing.settings_json);
      delete settingsObj.githubToken;

      db.prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?').run(
        JSON.stringify(settingsObj),
        userId
      );
    } catch {
      // Invalid JSON, just continue
    }
  }

  res.json({ success: true });
});

// Get GitHub token for internal use (returns full decrypted token)
export function getGitHubTokenForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

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
  const envKey = process.env.MISTRAL_API_KEY || '';

  const settings = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedKey = parsed.mistralApiKey;
    if (typeof encryptedKey === 'string') {
      const apiKey = safeDecrypt(encryptedKey);
      if (apiKey) {
        res.json({
          success: true,
          data: {
            hasKey: true,
            keyPreview: `${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`,
            source: 'user' as const,
            envFallback: !!envKey,
          },
        });
        return;
      }
    }
  }

  res.json({
    success: true,
    data: {
      hasKey: !!envKey,
      keyPreview: envKey ? `${envKey.substring(0, 8)}...${envKey.slice(-4)}` : null,
      source: envKey ? ('env' as const) : ('none' as const),
      envFallback: !!envKey,
    },
  });
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
  const existing = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  const settingsObj = safeJsonParse<Record<string, unknown>>(existing?.settings_json, {});

  // Encrypt the API key before storing
  settingsObj.mistralApiKey = safeEncrypt(apiKey);

  db.prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?').run(
    JSON.stringify(settingsObj),
    userId
  );

  res.json({
    success: true,
    data: {
      hasKey: true,
      keyPreview: `${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`,
    },
  });
});

// Delete Mistral API key
router.delete('/mistral-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Get existing settings_json
  const existing = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    const settingsObj = safeJsonParse<Record<string, unknown>>(existing.settings_json, {});
    delete settingsObj.mistralApiKey;

    db.prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?').run(
      JSON.stringify(settingsObj),
      userId
    );
  }

  res.json({ success: true });
});

// Get Mistral API key for internal use (returns full decrypted key)
export function getMistralApiKeyForUser(userId: string): string | null {
  const db = getDatabase();

  const settings = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedKey = parsed.mistralApiKey;
    if (typeof encryptedKey === 'string') {
      return safeDecrypt(encryptedKey);
    }
  }

  return null;
}

// ComfyUI / LoRA Tester integration URLs (admin-wide, stored in app_config)
const integrationsSchema = z.object({
  comfyuiUrl: z.string().trim().url().or(z.literal('')).nullable().optional(),
  loraTesterUrl: z.string().trim().url().or(z.literal('')).nullable().optional(),
});

router.get('/integrations', requireAuth, (_req, res) => {
  res.json({
    success: true,
    data: {
      comfyuiUrl: getAppConfig('comfyui_url') ?? '',
      loraTesterUrl: getAppConfig('lora_tester_url') ?? '',
    },
  });
});

router.put('/integrations', requireAuth, (req, res) => {
  const parsed = integrationsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { comfyuiUrl, loraTesterUrl } = parsed.data;

  if (comfyuiUrl !== undefined) {
    setAppConfig('comfyui_url', (comfyuiUrl ?? '').trim());
  }
  if (loraTesterUrl !== undefined) {
    setAppConfig('lora_tester_url', (loraTesterUrl ?? '').trim());
  }

  res.json({
    success: true,
    data: {
      comfyuiUrl: getAppConfig('comfyui_url') ?? '',
      loraTesterUrl: getAppConfig('lora_tester_url') ?? '',
    },
  });
});

export default router;
