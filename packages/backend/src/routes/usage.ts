import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDatabase } from '../db';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers';
import { safeJsonParse } from '../utils/json';

const router = Router();
const claudeCredentialsRoot = CLI_PROVIDERS.claude.credentialsPath;
const credentialsPath = path.join(
  claudeCredentialsRoot.replace('~', os.homedir()),
  '.credentials.json'
);
const codexCredentialsRoot = CLI_PROVIDERS.codex.credentialsPath;
const codexAuthPath = path.join(codexCredentialsRoot.replace('~', os.homedir()), 'auth.json');
interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

interface CodexAuthTokens {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  // account_id is sometimes stored directly in tokens by recent codex versions;
  // older versions only carry it inside the id_token JWT claims.
  account_id?: string;
}

interface CodexAuth {
  OPENAI_API_KEY?: string | null;
  tokens?: CodexAuthTokens;
  last_refresh?: string;
}

// OAuth client id used by the codex CLI for token refresh. Matches the upstream
// `wakamex/codex-cli-usage` reference implementation. Using the JWT `aud` claim
// instead (our previous approach) fails because Codex's refresh endpoint
// rejects mismatched client IDs.
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// Real Codex usage response shape from /backend-api/codex/usage.
interface CodexWindow {
  used_percent?: number;
  reset_at?: number; // unix epoch seconds
  limit_window_seconds?: number;
}

interface CodexAdditionalLimit {
  limit_name?: string;
  rate_limit?: CodexWindow;
}

interface CodexUsageApiResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
  additional_rate_limits?: CodexAdditionalLimit[];
}

interface UsageLimitResponse {
  five_hour: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day_opus: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day_oauth_apps?: unknown;
  iguana_necktie?: unknown;
}

interface LocalUsageBudget {
  dailyUsd?: number;
  weeklyUsd?: number;
}

// Get Claude credentials from ~/.claude/.credentials.json
async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function getCodexAuth(): Promise<CodexAuth | null> {
  try {
    const content = await fs.readFile(codexAuthPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizePercent(value?: number): number {
  if (value === undefined || value === null) return 0;
  if (value < 1) return Math.round(value * 100);
  return Math.round(value);
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function refreshCodexToken(auth: CodexAuth): Promise<CodexAuth | null> {
  if (!auth.tokens?.refresh_token) {
    return null;
  }

  try {
    const response = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.tokens.refresh_token,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      console.error('Codex token refresh failed:', response.status, await response.text());
      return null;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      id_token?: string;
      refresh_token?: string;
    };

    const updated: CodexAuth = {
      ...auth,
      tokens: {
        ...auth.tokens,
        access_token: tokens.access_token,
        id_token: tokens.id_token || auth.tokens.id_token,
        refresh_token: tokens.refresh_token || auth.tokens.refresh_token,
      },
      last_refresh: new Date().toISOString(),
    };

    await fs.writeFile(codexAuthPath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch (err) {
    console.error('Codex token refresh error:', err);
    return null;
  }
}

/**
 * Derive the ChatGPT account id required by the usage endpoint. Prefers the
 * literal `tokens.account_id` field (set by recent codex versions); falls back
 * to the JWT `chatgpt_account_id` claim under
 * `https://api.openai.com/auth.chatgpt_account_id` in the id_token.
 */
function getCodexAccountId(auth: CodexAuth): string | null {
  if (auth.tokens?.account_id) return auth.tokens.account_id;
  const payload = decodeJwtPayload(auth.tokens?.id_token);
  if (!payload) return null;
  const authClaim = payload['https://api.openai.com/auth'] as
    | { chatgpt_account_id?: string }
    | undefined;
  return authClaim?.chatgpt_account_id || null;
}

function mapCodexWindow(
  window?: CodexWindow
): { utilization: number; resetsAt: string | null } | null {
  if (!window) return null;
  const pct = normalizePercent(window.used_percent);
  const resetsAt =
    typeof window.reset_at === 'number' ? new Date(window.reset_at * 1000).toISOString() : null;
  return { utilization: pct, resetsAt };
}

function mapCodexUsage(data: CodexUsageApiResponse | null): {
  plan: string | null;
  fiveHour: { utilization: number; resetsAt: string | null } | null;
  sevenDay: { utilization: number; resetsAt: string | null } | null;
  additional: Array<{ name: string; utilization: number; resetsAt: string | null }>;
} {
  if (!data) {
    return { plan: null, fiveHour: null, sevenDay: null, additional: [] };
  }
  const rl = data.rate_limit;
  const additional = (data.additional_rate_limits || [])
    .map((item) => {
      const window = mapCodexWindow(item.rate_limit);
      if (!window) return null;
      return {
        name: item.limit_name || 'limit',
        utilization: window.utilization,
        resetsAt: window.resetsAt,
      };
    })
    .filter((x): x is { name: string; utilization: number; resetsAt: string | null } => x !== null);

  return {
    plan: data.plan_type ?? null,
    fiveHour: mapCodexWindow(rl?.primary_window),
    sevenDay: mapCodexWindow(rl?.secondary_window),
    additional,
  };
}

function normalizeBudgetValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function getEnvBudget(provider: CLIProvider, window: 'daily' | 'weekly'): number | undefined {
  const specific =
    process.env[`LOCAL_USAGE_BUDGET_${provider.toUpperCase()}_${window.toUpperCase()}_USD`];
  const shared = process.env[`LOCAL_USAGE_BUDGET_${window.toUpperCase()}_USD`];
  const raw = specific || shared;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getLocalUsageBudget(userId: string, provider: CLIProvider): LocalUsageBudget {
  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json?: string | null } | undefined;

  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const budgets =
    settings.localUsageBudgets && typeof settings.localUsageBudgets === 'object'
      ? (settings.localUsageBudgets as Record<string, unknown>)
      : {};
  const providerBudget =
    budgets[provider] && typeof budgets[provider] === 'object'
      ? (budgets[provider] as Record<string, unknown>)
      : {};

  return {
    dailyUsd: normalizeBudgetValue(providerBudget.dailyUsd) ?? getEnvBudget(provider, 'daily'),
    weeklyUsd: normalizeBudgetValue(providerBudget.weeklyUsd) ?? getEnvBudget(provider, 'weekly'),
  };
}

function providerSqlPredicate(provider: CLIProvider): string {
  switch (provider) {
    case 'codex':
      return "(lower(model) LIKE 'gpt-%' OR lower(model) LIKE '%codex%')";
    case 'claude':
      return "(lower(model) LIKE 'claude%' OR lower(model) IN ('opus', 'sonnet', 'haiku'))";
    case 'vibe':
      return "(lower(model) LIKE 'mistral-%' OR lower(model) LIKE 'devstral-%')";
    case 'opencode':
      return "(instr(model, '/') > 0 OR lower(model) LIKE '%opencode%')";
  }
}

function nextLocalReset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function pct(spend: number, budget?: number): number {
  if (!budget || budget <= 0) return 0;
  return Math.min(999, Math.round((spend / budget) * 100));
}

function fetchLocalBudgetUsage(userId: string, provider: CLIProvider) {
  const budget = getLocalUsageBudget(userId, provider);
  if (!budget.dailyUsd && !budget.weeklyUsd) {
    return null;
  }

  const db = getDatabase();
  const predicate = providerSqlPredicate(provider);
  const daily = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(total_tokens), 0) as tokens, COUNT(*) as requests
       FROM usage_history
       WHERE user_id = ? AND created_at >= datetime('now', '-1 day') AND ${predicate}`
    )
    .get(userId) as { cost: number; tokens: number; requests: number };
  const weekly = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(total_tokens), 0) as tokens, COUNT(*) as requests
       FROM usage_history
       WHERE user_id = ? AND created_at >= datetime('now', '-7 days') AND ${predicate}`
    )
    .get(userId) as { cost: number; tokens: number; requests: number };

  return {
    subscriptionType: 'local-budget',
    rateLimitTier: 'local-budget',
    fiveHour: budget.dailyUsd
      ? { utilization: pct(daily.cost, budget.dailyUsd), resetsAt: nextLocalReset(1) }
      : null,
    sevenDay: budget.weeklyUsd
      ? { utilization: pct(weekly.cost, budget.weeklyUsd), resetsAt: nextLocalReset(7) }
      : null,
    sevenDaySonnet: null,
    localBudget: {
      dailyUsd: budget.dailyUsd ?? null,
      weeklyUsd: budget.weeklyUsd ?? null,
      dailySpendUsd: daily.cost,
      weeklySpendUsd: weekly.cost,
      dailyTokens: daily.tokens,
      weeklyTokens: weekly.tokens,
      dailyRequests: daily.requests,
      weeklyRequests: weekly.requests,
    },
  };
}

async function fetchCodexUsage(auth: CodexAuth): Promise<CodexUsageApiResponse | null> {
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) return null;

  const accountId = getCodexAccountId(auth);
  // Cloudflare in front of chatgpt.com flags some Linux/Firefox UAs as bots
  // and serves a JS challenge page. A current Mac Safari UA reliably passes.
  // Override via `CODEX_USER_AGENT` env if needed.
  const userAgent =
    process.env.CODEX_USER_AGENT ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const url = process.env.CODEX_USAGE_URL || 'https://chatgpt.com/backend-api/codex/usage';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': userAgent,
  };
  if (accountId) {
    // Header name is lowercase in the upstream Python reference and that's what
    // the backend matches against. Some HTTP clients lowercase headers anyway,
    // but be explicit.
    headers['chatgpt-account-id'] = accountId;
  }

  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Codex usage error: ${response.status} ${errorText}`);
  }

  return (await response.json()) as CodexUsageApiResponse;
}

// Refresh Claude OAuth token
async function refreshClaudeToken(refreshToken: string): Promise<ClaudeCredentials | null> {
  try {
    const endpoints = [
      'https://api.anthropic.com/oauth/token',
      'https://console.anthropic.com/api/oauth/token',
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
        }),
      });

      if (!response.ok) {
        console.error(`Token refresh failed (${endpoint}):`, await response.text());
        continue;
      }

      const tokens = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Read existing credentials to preserve other fields
      const existing = await getClaudeCredentials();
      const updated: ClaudeCredentials = {
        claudeAiOauth: {
          ...existing?.claudeAiOauth,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes: existing?.claudeAiOauth?.scopes || [],
          subscriptionType: existing?.claudeAiOauth?.subscriptionType || 'unknown',
          rateLimitTier: existing?.claudeAiOauth?.rateLimitTier || 'unknown',
        },
      };

      await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
      console.log('Claude token refreshed successfully');
      return updated;
    }

    return null;
  } catch (err) {
    console.error('Token refresh error:', err);
    return null;
  }
}

// Helper to fetch usage with a given access token
async function fetchUsage(
  accessToken: string
): Promise<{ ok: boolean; status: number; data?: UsageLimitResponse; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code-webui/1.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, status: response.status, error: errorText };
    }

    const data = (await response.json()) as UsageLimitResponse;
    return { ok: true, status: 200, data };
  } catch (err) {
    console.error('Fetch usage error:', err);
    return { ok: false, status: 500, error: String(err) };
  }
}

// Fetch usage limits (Claude only)
router.get('/limits', requireAuth, async (req, res) => {
  try {
    const providerParam = String(req.query.provider || 'claude').toLowerCase();
    const allowedProviders: CLIProvider[] = ['claude', 'codex', 'opencode', 'vibe'];
    const provider = allowedProviders.includes(providerParam as CLIProvider)
      ? (providerParam as CLIProvider)
      : 'claude';

    if (provider === 'codex') {
      const codexAuth = await getCodexAuth();
      if (!codexAuth?.tokens?.access_token) {
        return res.json({
          success: false,
          supported: false,
          provider: 'codex',
          data: null,
          error: { code: 'NO_CREDENTIALS', message: 'Codex credentials not found' },
        });
      }

      const buildCodexResponse = (mapped: ReturnType<typeof mapCodexUsage>) => ({
        success: true,
        supported: true,
        provider: 'codex' as const,
        data: {
          // Mirror Claude's shape so the existing frontend usage card renders without
          // changes: subscriptionType / rateLimitTier are surfaced for the badge,
          // fiveHour / sevenDay are the two primary windows.
          subscriptionType: mapped.plan ?? 'codex',
          rateLimitTier: mapped.plan ?? 'codex',
          fiveHour: mapped.fiveHour,
          sevenDay: mapped.sevenDay,
          // Codex doesn't have a Sonnet-equivalent third window; keep the field
          // null for shape compatibility.
          sevenDaySonnet: null,
          // Extra per-model / per-feature limits (e.g. code-review). Frontend can
          // optionally render these as additional bars beside the main two.
          additional: mapped.additional,
        },
      });

      try {
        const usage = await fetchCodexUsage(codexAuth);
        if (!usage) {
          return res.json({ success: true, supported: false, provider: 'codex', data: null });
        }
        return res.json(buildCodexResponse(mapCodexUsage(usage)));
      } catch (err) {
        const errorText = String(err);
        const isAuthError = errorText.includes('401') || errorText.includes('403');
        if (isAuthError) {
          const refreshed = await refreshCodexToken(codexAuth);
          if (refreshed?.tokens?.access_token) {
            try {
              const usage = await fetchCodexUsage(refreshed);
              return res.json(buildCodexResponse(mapCodexUsage(usage)));
            } catch (retryErr) {
              console.error('Codex usage retry error:', retryErr);
            }
          }
          return res.json({
            success: false,
            supported: false,
            provider: 'codex',
            data: null,
            error: { code: 'NO_CREDENTIALS', message: 'Codex credentials not found or expired' },
          });
        }

        console.error('Codex usage fetch error:', err);
        return res.status(502).json({
          success: false,
          error: {
            code: 'CODEX_USAGE_ERROR',
            message: `Failed to fetch Codex usage: ${errorText}`,
          },
        });
      }
    }

    if (provider === 'opencode' || provider === 'vibe') {
      const userId = (req as AuthenticatedRequest).userId;
      const localUsage = fetchLocalBudgetUsage(userId, provider);
      if (localUsage) {
        return res.json({
          success: true,
          supported: true,
          provider,
          data: localUsage,
        });
      }

      return res.json({
        success: true,
        supported: false,
        provider,
        data: null,
        error: {
          code: 'LOCAL_BUDGET_NOT_CONFIGURED',
          message:
            'No local usage budget is configured. Set localUsageBudgets in user settings or LOCAL_USAGE_BUDGET_*_USD env vars.',
        },
      });
    }

    let credentials = await getClaudeCredentials();

    if (!credentials?.claudeAiOauth?.accessToken) {
      return res.json({
        success: false,
        supported: false,
        provider: 'claude',
        data: null,
        error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found' },
      });
    }

    let { accessToken, subscriptionType, rateLimitTier } = credentials.claudeAiOauth;
    const { refreshToken } = credentials.claudeAiOauth;

    // Try to fetch usage
    let result = await fetchUsage(accessToken);

    // If 401, try to refresh token and retry
    if (!result.ok && result.status === 401 && refreshToken) {
      console.log('Token expired, attempting refresh...');
      const refreshed = await refreshClaudeToken(refreshToken);

      if (refreshed?.claudeAiOauth?.accessToken) {
        credentials = refreshed;
        accessToken = refreshed.claudeAiOauth.accessToken;
        subscriptionType = refreshed.claudeAiOauth.subscriptionType;
        rateLimitTier = refreshed.claudeAiOauth.rateLimitTier;
        result = await fetchUsage(accessToken);
      }
    }

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        return res.json({
          success: false,
          supported: false,
          provider: 'claude',
          data: null,
          error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found or expired' },
        });
      }
      console.error('Claude API error:', result.status, result.error);
      return res.status(result.status).json({
        success: false,
        error: { code: 'API_ERROR', message: `Claude API error: ${result.status}` },
      });
    }

    const usageData = result.data!;

    // Transform to frontend-friendly format
    res.json({
      success: true,
      supported: true,
      provider: 'claude',
      data: {
        subscriptionType,
        rateLimitTier,
        fiveHour: usageData.five_hour
          ? {
              utilization: usageData.five_hour.utilization,
              resetsAt: usageData.five_hour.resets_at,
            }
          : null,
        sevenDay: usageData.seven_day
          ? {
              utilization: usageData.seven_day.utilization,
              resetsAt: usageData.seven_day.resets_at,
            }
          : null,
        sevenDaySonnet: usageData.seven_day_opus
          ? {
              utilization: usageData.seven_day_opus.utilization,
              resetsAt: usageData.seven_day_opus.resets_at,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('Failed to fetch usage limits:', err);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch usage limits' },
    });
  }
});

export default router;
