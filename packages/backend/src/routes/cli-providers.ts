import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import type { ApiResponse, CliProviderUpdateResponse } from '@claude-code-webui/shared';
import {
  CLI_PROVIDERS,
  getAvailableProviders,
  getCliModels,
  getModelDisplayLabels,
  refreshCodexModelsCache,
  resetDiscovery,
  type CLIProvider,
  type CLIProviderConfig,
} from '../services/cli-providers.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { CLI_UPDATE_PROVIDERS, runCliUpdates } from '../services/cli-updates.js';

const router = Router();

const updateCliProvidersSchema = z.object({
  providers: z.array(z.enum(CLI_UPDATE_PROVIDERS)).optional(),
});

// Get all CLI providers (with availability status)
router.get('/', requireAuth, async (_req, res) => {
  try {
    const availableProviders = await getAvailableProviders();
    const availableIds = new Set(availableProviders.map((p) => p.id));

    const labels = getModelDisplayLabels();
    const providers = Object.values(CLI_PROVIDERS).map((provider) => {
      const models = getCliModels(provider.id);
      const providerLabels: Record<string, string> = {};
      for (const m of models) {
        if (labels[m]) providerLabels[m] = labels[m];
      }
      return {
        ...provider,
        models,
        modelLabels: providerLabels,
        available: availableIds.has(provider.id),
      };
    });

    const response: ApiResponse<typeof providers> = {
      success: true,
      data: providers,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch CLI providers' },
    };
    res.status(500).json(response);
  }
});

// Get available CLI providers only
router.get('/available', requireAuth, async (_req, res) => {
  try {
    const providers = await getAvailableProviders();

    const providersWithModels = providers.map((provider) => ({
      ...provider,
      models: getCliModels(provider.id),
    }));

    const response: ApiResponse<CLIProviderConfig[]> = {
      success: true,
      data: providersWithModels,
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch available providers' },
    };
    res.status(500).json(response);
  }
});

// Get specific CLI provider info
router.get('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const provider = CLI_PROVIDERS[id as CLIProvider];

  if (!provider) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'CLI provider not found' },
    };
    return res.status(404).json(response);
  }

  const response: ApiResponse<CLIProviderConfig> = {
    success: true,
    data: { ...provider, models: getCliModels(id as CLIProvider) },
  };
  res.json(response);
});

// Get models for a specific CLI provider
router.get('/:id/models', requireAuth, (req, res) => {
  const { id } = req.params;
  const provider = CLI_PROVIDERS[id as CLIProvider];

  if (!provider) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'CLI provider not found' },
    };
    return res.status(404).json(response);
  }

  const response: ApiResponse<{
    provider: string;
    models: string[];
    defaultModel: string | undefined;
  }> = {
    success: true,
    data: {
      provider: id!,
      models: getCliModels(id as CLIProvider),
      defaultModel: provider.defaultModel,
    },
  };
  res.json(response);
});

// Refresh models cache (re-reads from CLI cache files).
// Admin-only: spawns `codex exec` (up to 30s, hits OpenAI API). Rate-limited to
// 10/min per admin, with an in-flight lock in refreshCodexModelsCache so parallel
// callers share one run.
router.post(
  '/refresh-models',
  requireAuth,
  requireAdmin,
  rateLimiters.strict,
  asyncHandler(async (_req, res) => {
    resetDiscovery();
    const codexRefreshed = await refreshCodexModelsCache();

    const labels = getModelDisplayLabels();
    const providers = Object.values(CLI_PROVIDERS).map((provider) => {
      const models = getCliModels(provider.id);
      const providerLabels: Record<string, string> = {};
      for (const m of models) {
        if (labels[m]) providerLabels[m] = labels[m];
      }
      return { id: provider.id, models, modelLabels: providerLabels };
    });

    const response: ApiResponse<{ providers: typeof providers; codexCacheRefreshed: boolean }> = {
      success: true,
      data: { providers, codexCacheRefreshed: codexRefreshed },
    };
    res.json(response);
  })
);

// Admin-only: `npm install -g` spawns with a 5-minute timeout and a shared
// in-flight lock, so any authed user could exhaust container resources or
// stall concurrent updates. Restrict to admins.
router.post(
  '/update',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateCliProvidersSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const providers: CLIProvider[] | undefined = parsed.data.providers?.length
      ? [...parsed.data.providers]
      : undefined;
    const response: ApiResponse<CliProviderUpdateResponse> = {
      success: true,
      data: await runCliUpdates(providers),
    };
    res.json(response);
  })
);

export default router;
