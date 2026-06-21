import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { safeEncrypt, safeDecrypt } from '../utils/encryption.js';
import type { ApiResponse } from '@plum-code-webui/shared';

const router = Router();

// Provider types supported
export type ProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama' | 'custom';

interface AIProvider {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  api_key_encrypted: string | null;
  base_url: string | null;
  models: string | null; // JSON array of model IDs
  default_model: string | null;
  enabled: number;
  auth_method: 'api_key' | 'oauth' | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AIProviderResponse {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  base_url: string | null;
  models: string | null;
  default_model: string | null;
  enabled: number;
  auth_method: 'api_key' | 'oauth' | null;
  has_oauth_token: boolean;
  oauth_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// Default models for each provider
const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  openai: ['o3', 'o3-mini', 'gpt-4.5', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o1-pro'],
  anthropic: [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1-20250805',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  google: [
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  openrouter: [
    'openai/o3',
    'openai/gpt-4.5',
    'anthropic/claude-sonnet-4.5',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.3-70b',
  ],
  ollama: ['llama3.3', 'llama3.2', 'qwen2.5-coder', 'codellama', 'mistral', 'mixtral'],
  custom: [],
};

// Default base URLs
const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434',
  custom: '',
};

function transformProvider(p: AIProvider): AIProviderResponse {
  return {
    id: p.id,
    user_id: p.user_id,
    name: p.name,
    type: p.type,
    base_url: p.base_url,
    models: p.models,
    default_model: p.default_model,
    enabled: p.enabled,
    auth_method: p.auth_method || 'api_key',
    has_oauth_token: !!p.oauth_access_token,
    oauth_expires_at: p.oauth_expires_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// Get all providers for user
router.get('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();

  try {
    const providers = db
      .prepare(
        `SELECT id, user_id, name, type, api_key_encrypted, base_url, models, default_model, enabled,
       auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at,
       created_at, updated_at
  FROM ai_providers WHERE user_id = ? ORDER BY name ASC`
      )
      .all(authReq.userId) as AIProvider[];

    const response: ApiResponse<AIProviderResponse[]> = {
      success: true,
      data: providers.map(transformProvider),
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch providers' },
    };
    res.status(500).json(response);
  }
});

// Get available provider types and their default models
router.get('/types', requireAuth, (_req, res) => {
  const types = Object.keys(DEFAULT_MODELS) as ProviderType[];
  const data = types.map((type) => ({
    id: type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    baseUrl: DEFAULT_BASE_URLS[type],
    models: DEFAULT_MODELS[type],
    requiresApiKey: type !== 'ollama',
    supportsOAuth: type === 'google',
    icon: type,
  }));

  const response: ApiResponse<typeof data> = {
    success: true,
    data,
  };
  res.json(response);
});

// Create a new provider
router.post('/', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { name, type, apiKey, baseUrl, models, defaultModel } = req.body;

  if (!name || !type) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Name and type are required' },
    };
    return res.status(400).json(response);
  }

  try {
    const id = nanoid();

    db.prepare(
      `INSERT INTO ai_providers (id, user_id, name, type, api_key_encrypted, base_url, models, default_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      authReq.userId,
      name,
      type,
      safeEncrypt(apiKey), // Encrypt API key
      baseUrl || DEFAULT_BASE_URLS[type as ProviderType] || null,
      models ? (typeof models === 'string' ? models : JSON.stringify(models)) : null,
      defaultModel || null
    );

    const provider = db
      .prepare(
        `SELECT id, user_id, name, type, api_key_encrypted, base_url, models, default_model, enabled,
       auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at,
       created_at, updated_at
  FROM ai_providers WHERE id = ?`
      )
      .get(id) as AIProvider;

    const response: ApiResponse<AIProviderResponse> = {
      success: true,
      data: transformProvider(provider),
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create provider' },
    };
    res.status(500).json(response);
  }
});

// Update a provider
router.patch('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;
  const { name, apiKey, baseUrl, models, defaultModel, enabled } = req.body;

  try {
    // Check ownership
    const existing = db
      .prepare(
        `SELECT id, user_id, name, type, api_key_encrypted, base_url, models, default_model, enabled,
       auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at,
       created_at, updated_at
  FROM ai_providers WHERE id = ? AND user_id = ?`
      )
      .get(id, authReq.userId) as AIProvider | undefined;

    if (!existing) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Provider not found' },
      };
      return res.status(404).json(response);
    }

    // Build update query
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: (string | number | null)[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (apiKey !== undefined && apiKey !== '') {
      updates.push('api_key_encrypted = ?');
      values.push(safeEncrypt(apiKey)); // Encrypt API key
    }
    if (baseUrl !== undefined) {
      updates.push('base_url = ?');
      values.push(baseUrl);
    }
    if (models !== undefined) {
      updates.push('models = ?');
      values.push(typeof models === 'string' ? models : JSON.stringify(models));
    }
    if (defaultModel !== undefined) {
      updates.push('default_model = ?');
      values.push(defaultModel ?? null);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }

    values.push(id as string);
    db.prepare(`UPDATE ai_providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const provider = db
      .prepare(
        `SELECT id, user_id, name, type, api_key_encrypted, base_url, models, default_model, enabled,
       auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at,
       created_at, updated_at
  FROM ai_providers WHERE id = ?`
      )
      .get(id) as AIProvider;

    const response: ApiResponse<AIProviderResponse> = {
      success: true,
      data: transformProvider(provider),
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update provider' },
    };
    res.status(500).json(response);
  }
});

// Delete a provider
router.delete('/:id', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  try {
    const result = db
      .prepare(`DELETE FROM ai_providers WHERE id = ? AND user_id = ?`)
      .run(id, authReq.userId);

    if (result.changes === 0) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Provider not found' },
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
      error: { code: 'DELETE_ERROR', message: 'Failed to delete provider' },
    };
    res.status(500).json(response);
  }
});

// Test provider connection
router.post('/:id/test', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  try {
    const provider = db
      .prepare(
        `SELECT id, user_id, name, type, api_key_encrypted, base_url, models, default_model, enabled,
       auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at,
       created_at, updated_at
  FROM ai_providers WHERE id = ? AND user_id = ?`
      )
      .get(id, authReq.userId) as AIProvider | undefined;

    if (!provider) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Provider not found' },
      };
      return res.status(404).json(response);
    }

    // Simple test based on provider type
    let testResult = { success: false, message: 'Unknown provider type' };

    try {
      // Decrypt API key / OAuth token for testing
      const apiKey = safeDecrypt(provider.api_key_encrypted);
      const oauthAccessToken = safeDecrypt(provider.oauth_access_token);
      const authToken =
        provider.auth_method === 'oauth' && oauthAccessToken ? oauthAccessToken : apiKey;

      switch (provider.type) {
        case 'openai': {
          const baseUrl = provider.base_url || DEFAULT_BASE_URLS[provider.type];
          if (!authToken) {
            testResult = { success: false, message: 'No API key or OAuth token configured' };
            break;
          }
          const response = await fetch(`${baseUrl}/models`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          testResult = {
            success: response.ok,
            message: response.ok ? 'Connected successfully' : 'Failed to connect',
          };
          break;
        }
        case 'google': {
          // Test Gemini API
          if (provider.auth_method === 'oauth' && oauthAccessToken) {
            const baseUrl = provider.base_url || DEFAULT_BASE_URLS.google;
            const response = await fetch(`${baseUrl}/models`, {
              headers: { Authorization: `Bearer ${oauthAccessToken}` },
            });
            testResult = {
              success: response.ok,
              message: response.ok ? 'Connected via OAuth' : 'OAuth token may have expired',
            };
          } else if (apiKey) {
            const baseUrl = provider.base_url || DEFAULT_BASE_URLS.google;
            const response = await fetch(`${baseUrl}/models?key=${apiKey}`);
            testResult = {
              success: response.ok,
              message: response.ok ? 'Connected successfully' : 'Failed to connect',
            };
          } else {
            testResult = { success: false, message: 'No API key or OAuth token configured' };
          }
          break;
        }
        case 'ollama': {
          const response = await fetch(`${provider.base_url || DEFAULT_BASE_URLS.ollama}/api/tags`);
          testResult = {
            success: response.ok,
            message: response.ok ? 'Connected successfully' : 'Failed to connect',
          };
          break;
        }
        default:
          testResult = {
            success: true,
            message: 'Provider configured (no connection test available)',
          };
      }
    } catch (error) {
      testResult = {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }

    const response: ApiResponse<typeof testResult> = {
      success: true,
      data: testResult,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'TEST_ERROR', message: 'Failed to test provider' },
    };
    res.status(500).json(response);
  }
});

export default router;
