import { Router, type Request, type Response } from 'express';
import { existsSync } from 'fs';
import os from 'os';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  CLI_PROVIDERS,
  getCliModels,
  isProviderAvailable,
  type CLIProvider,
} from '../services/cli-providers.js';
import { getEnabledCliProvidersForUser, getZaiApiConfigForUser } from './settings.js';
import { readOpenCodeProvidersForUser } from '../utils/opencodeProviderKeys.js';
import { getPiModelsForUser } from '../utils/piConfig.js';
import type { ApiResponse } from '@plum-code-webui/shared';

const router = Router();

/**
 * How an operator makes a harness usable. The wizard renders a different step
 * per kind, so this belongs next to the harness definition rather than being
 * re-derived in the client.
 */
type SetupKind = 'cli-login' | 'provider-keys' | 'endpoint';

const SETUP_KIND: Record<CLIProvider, SetupKind> = {
  codex: 'cli-login',
  claude: 'cli-login',
  kimi: 'cli-login',
  opencode: 'provider-keys',
  pi: 'provider-keys',
  zai: 'endpoint',
};

const SETUP_HINT: Record<SetupKind, string> = {
  'cli-login': 'Sign in once through the CLI login flow.',
  'provider-keys': 'Add at least one API endpoint and key.',
  endpoint: 'Point the harness at an Anthropic-compatible endpoint.',
};

function isInstalled(provider: CLIProvider): boolean {
  const command = CLI_PROVIDERS[provider].command;
  // An absolute path is the configured binary; a bare name is resolved from
  // PATH, which we cannot probe cheaply, so treat it as present and let the
  // credential check decide.
  if (!command.includes('/')) return true;
  return existsSync(command.replace('~', os.homedir()));
}

/**
 * GET /api/setup/status
 *
 * Everything the first-run wizard needs in one call: which harnesses this
 * account can already use, what each one still needs, and whether the instance
 * is usable at all. Exactly one ready harness is enough — the rest are optional
 * and stay that way.
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const enabled = new Set(getEnabledCliProvidersForUser(userId));
  const zaiConfig = getZaiApiConfigForUser(userId);
  const registryProviders = readOpenCodeProvidersForUser(userId);
  const configuredEndpoints = registryProviders.filter(
    (entry) => entry.enabled && entry.apiKey.trim().length > 0
  );

  const harnesses = await Promise.all(
    Object.values(CLI_PROVIDERS).map(async (provider) => {
      const kind = SETUP_KIND[provider.id];
      const credentials =
        provider.id === 'zai' ? zaiConfig !== null : await isProviderAvailable(provider.id, userId);

      const models =
        provider.id === 'pi'
          ? getPiModelsForUser(userId)
          : provider.id === 'opencode'
            ? getCliModels('opencode')
            : (provider.models ?? []);

      return {
        id: provider.id,
        name: provider.name,
        icon: provider.icon,
        kind,
        hint: SETUP_HINT[kind],
        installed: isInstalled(provider.id),
        credentials,
        enabled: enabled.has(provider.id),
        modelCount: models.length,
        // Ready means "a turn would run", which is what the wizard ticks off.
        ready: credentials && enabled.has(provider.id) && models.length > 0,
      };
    })
  );

  const ready = harnesses.filter((harness) => harness.ready);
  const response: ApiResponse<{
    ready: boolean;
    readyHarnesses: string[];
    configuredEndpoints: number;
    harnesses: typeof harnesses;
  }> = {
    success: true,
    data: {
      ready: ready.length > 0,
      readyHarnesses: ready.map((harness) => harness.id),
      configuredEndpoints: configuredEndpoints.length,
      harnesses,
    },
  };
  res.json(response);
});

export default router;
