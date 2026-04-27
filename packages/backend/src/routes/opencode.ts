import { Router } from 'express';
import { z } from 'zod';
import { execSync } from 'child_process';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { safeEncrypt, safeDecrypt } from '../utils/encryption';

const router = Router();

interface OpenCodeProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserSettingsRow {
  settings_json: string | null;
}

function readProviders(userId: string): OpenCodeProvider[] {
  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as UserSettingsRow | undefined;

  if (!row?.settings_json) return [];

  try {
    const parsed = JSON.parse(row.settings_json) as { opencodeProviders?: OpenCodeProvider[] };
    return Array.isArray(parsed.opencodeProviders) ? parsed.opencodeProviders : [];
  } catch {
    return [];
  }
}

function writeProviders(userId: string, providers: OpenCodeProvider[]): void {
  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as UserSettingsRow | undefined;

  let settings: Record<string, unknown> = {};
  if (row?.settings_json) {
    try {
      settings = JSON.parse(row.settings_json) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  settings.opencodeProviders = providers;
  const json = JSON.stringify(settings);

  if (row) {
    db.prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?').run(json, userId);
  } else {
    db.prepare('INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)').run(userId, json);
  }
}

// Get all OpenCode providers for the current user
router.get('/providers', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const providers = readProviders(userId);
    const safeProviders = providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? '***' : '',
      hasKey: !!p.apiKey,
    }));
    res.json({ success: true, data: safeProviders });
  } catch (error) {
    console.error('Error fetching OpenCode providers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch providers' });
  }
});

const upsertProviderSchema = z.object({
  id: z.string().min(1, 'Provider ID is required'),
  name: z.string().min(1, 'Provider name is required'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean().optional(),
});

// Save or update an OpenCode provider
router.put('/providers', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const result = upsertProviderSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error.flatten() });
    }

    const { id, name, apiKey, baseUrl, enabled = true } = result.data;
    const finalBaseUrl = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;

    const providers = readProviders(userId);
    const now = new Date().toISOString();
    const existingIndex = providers.findIndex((p) => p.id === id);
    const encryptedKey = apiKey ? (safeEncrypt(apiKey) ?? '') : '';

    let stored: OpenCodeProvider;
    if (existingIndex >= 0) {
      const existing = providers[existingIndex]!;
      stored = {
        id,
        name,
        apiKey: apiKey ? encryptedKey : existing.apiKey,
        baseUrl: finalBaseUrl,
        enabled,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      providers[existingIndex] = stored;
    } else {
      stored = {
        id,
        name,
        apiKey: encryptedKey,
        baseUrl: finalBaseUrl,
        enabled,
        createdAt: now,
        updatedAt: now,
      };
      providers.push(stored);
    }

    writeProviders(userId, providers);

    res.json({
      success: true,
      data: {
        ...stored,
        apiKey: stored.apiKey ? '***' : '',
        hasKey: !!stored.apiKey,
      },
    });
  } catch (error) {
    console.error('Error saving OpenCode provider:', error);
    res.status(500).json({ success: false, error: 'Failed to save provider' });
  }
});

// Delete an OpenCode provider
router.delete('/providers/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  try {
    const providers = readProviders(userId).filter((p) => p.id !== id);
    writeProviders(userId, providers);
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Error deleting OpenCode provider:', error);
    res.status(500).json({ success: false, error: 'Failed to delete provider' });
  }
});

// Test an OpenCode provider connection
router.post('/providers/:id/test', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, error: 'Provider id required' });
  }
  try {
    const providers = readProviders(userId);
    const provider = providers.find((p) => p.id === id);

    if (!provider) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }

    const envKey = `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [envKey]: (provider.apiKey ? safeDecrypt(provider.apiKey) : '') ?? '',
    };

    try {
      execSync(`opencode run --format json --model "${id}/test-model" "test" 2>&1 | head -1`, {
        encoding: 'utf-8',
        timeout: 10_000,
        env,
      });

      res.json({ success: true, data: { connected: true, message: 'Connection successful' } });
    } catch (testError) {
      const err = testError as { stdout?: string; message?: string };
      const output = err.stdout || err.message || '';
      const isAuthError = /auth|key|401|403/.test(output);
      res.json({
        success: true,
        data: {
          connected: false,
          message: isAuthError
            ? 'Authentication failed - check API key'
            : `Provider not reachable: ${output.substring(0, 100)}`,
        },
      });
    }
  } catch (error) {
    console.error('Error testing OpenCode provider:', error);
    res.status(500).json({ success: false, error: 'Test failed' });
  }
});

// Pretty names for provider IDs we've seen — everything else falls back to the
// raw id. This is display-only; the source of truth for which providers exist
// is whatever `opencode models` returns at runtime.
const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'z-ai': 'Z-AI',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  'x-ai': 'xAI',
  cohere: 'Cohere',
  google: 'Google',
  mistral: 'Mistral AI',
  together: 'Together AI',
  'ollama-cloud': 'Ollama Cloud',
  ollama: 'Ollama',
  opencode: 'OpenCode (built-in)',
};

type ProviderInfo = { name: string; models: string[]; description: string };
let providerCache: { data: Record<string, ProviderInfo>; expiresAt: number } | null = null;
const PROVIDER_CACHE_TTL_MS = 60_000;

function discoverProviders(): Record<string, ProviderInfo> {
  if (providerCache && providerCache.expiresAt > Date.now()) {
    return providerCache.data;
  }

  const grouped: Record<string, ProviderInfo> = {};

  try {
    const raw = execSync('opencode models 2>&1', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      // Each valid line is `<provider>/<model-id>`. Skip banners, warnings, blanks.
      const slash = trimmed.indexOf('/');
      if (slash <= 0 || /\s/.test(trimmed)) continue;

      const providerId = trimmed.slice(0, slash);
      const modelId = trimmed.slice(slash + 1);
      if (!providerId || !modelId) continue;

      if (!grouped[providerId]) {
        grouped[providerId] = {
          name: PROVIDER_NAMES[providerId] ?? providerId,
          models: [],
          description: `${providerId} (from opencode CLI)`,
        };
      }
      grouped[providerId].models.push(modelId);
    }
  } catch (error) {
    console.warn('[opencode] discoverProviders failed:', error);
  }

  providerCache = { data: grouped, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
  return grouped;
}

// Get available OpenCode providers and their models (live from CLI)
router.get('/available-providers', requireAuth, (_req, res) => {
  try {
    res.json({ success: true, data: discoverProviders() });
  } catch (error) {
    console.error('Error fetching available providers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch providers' });
  }
});

// Debug endpoint without auth to verify discovery
router.get('/available-providers-debug', (_req, res) => {
  res.json({ success: true, data: discoverProviders() });
});

export default router;
