import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import type { ApiResponse, CliProviderUpdateResponse } from '@claude-code-webui/shared';
import {
  CLI_PROVIDERS,
  getAvailableProviders,
  getCliModels,
  getModelDisplayLabels,
  getProviderCapabilities,
  isProviderAvailable,
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

function expandHome(value: string): string {
  return value.replace(/^~/, os.homedir());
}

function getCommandPath(command: string): string | null {
  try {
    return execFileSync('which', [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function getCommandVersion(command: string): string | null {
  try {
    return (
      execFileSync(command, ['--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      })
        .trim()
        .split('\n')[0] || null
    );
  } catch {
    return null;
  }
}

function countMcpServers(provider: CLIProvider): number {
  try {
    if (provider === 'opencode') {
      const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { mcp?: unknown };
      return parsed.mcp && typeof parsed.mcp === 'object' ? Object.keys(parsed.mcp).length : 0;
    }
    if (provider === 'vibe') {
      const configPath = path.join(os.homedir(), '.vibe', 'config.toml');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return (raw.match(/^\s*\[\[mcp_servers\]\]/gm) || []).length;
    }
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { mcpServers?: unknown };
    return parsed.mcpServers && typeof parsed.mcpServers === 'object'
      ? Object.keys(parsed.mcpServers).length
      : 0;
  } catch {
    return 0;
  }
}

function getCodexModelsCacheInfo() {
  const cachePath = path.join(expandHome(CLI_PROVIDERS.codex.credentialsPath), 'models_cache.json');
  try {
    const stat = fs.statSync(cachePath);
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
      fetched_at?: string;
      models?: unknown[];
    };
    return {
      path: cachePath,
      exists: true,
      fetchedAt: parsed.fetched_at ?? null,
      mtime: stat.mtime.toISOString(),
      modelCount: Array.isArray(parsed.models) ? parsed.models.length : 0,
    };
  } catch {
    return { path: cachePath, exists: false, fetchedAt: null, mtime: null, modelCount: 0 };
  }
}

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

router.get('/diagnostics', requireAuth, async (_req, res) => {
  const diagnostics = await Promise.all(
    Object.values(CLI_PROVIDERS).map(async (provider) => {
      const models = getCliModels(provider.id);
      const binaryPath = getCommandPath(provider.command);
      const credentialsPath = expandHome(provider.credentialsPath);
      const available = await isProviderAvailable(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        command: provider.command,
        binaryPath,
        installed: !!binaryPath,
        version: binaryPath ? getCommandVersion(provider.command) : null,
        credentialsPath,
        authenticated: available,
        defaultModel: provider.defaultModel ?? null,
        modelCount: models.length,
        models,
        capabilities: getProviderCapabilities(provider.id),
        mcpServerCount: countMcpServers(provider.id),
        codexModelsCache: provider.id === 'codex' ? getCodexModelsCacheInfo() : null,
      };
    })
  );

  res.json({ success: true, data: diagnostics });
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
