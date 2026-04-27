import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers';

const router = Router();
const claudeCredentialsRoot = CLI_PROVIDERS.claude.credentialsPath;
const credentialsPath = path.join(
  claudeCredentialsRoot.replace('~', os.homedir()),
  '.credentials.json'
);
const codexCredentialsRoot = CLI_PROVIDERS.codex.credentialsPath;
const codexAuthPath = path.join(
  codexCredentialsRoot.replace('~', os.homedir()),
  'auth.json'
);
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
}

interface CodexAuth {
  OPENAI_API_KEY?: string | null;
  tokens?: CodexAuthTokens;
  last_refresh?: string;
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

interface CodexLimitItem {
  type?: string;
  percentage?: number;
  utilization?: number;
  resets_at?: string | null;
}

interface CodexUsageResponse {
  five_hour?: { utilization?: number; resets_at?: string | null };
  seven_day?: { utilization?: number; resets_at?: string | null };
  seven_day_opus?: { utilization?: number; resets_at?: string | null };
  limits?: CodexLimitItem[];
  data?: {
    five_hour?: { utilization?: number; resets_at?: string | null };
    seven_day?: { utilization?: number; resets_at?: string | null };
    seven_day_opus?: { utilization?: number; resets_at?: string | null };
    limits?: CodexLimitItem[];
  };
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
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const payload = Buffer.from(padded, 'base64')
      .toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function refreshCodexToken(auth: CodexAuth): Promise<CodexAuth | null> {
  if (!auth.tokens?.refresh_token || !auth.tokens?.id_token) {
    return null;
  }

  const payload = decodeJwtPayload(auth.tokens.id_token);
  const aud = Array.isArray(payload?.aud) ? payload?.aud?.[0] : payload?.aud;
  if (typeof aud !== 'string') {
    return null;
  }

  try {
    const response = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.tokens.refresh_token,
        client_id: aud,
      }),
    });

    if (!response.ok) {
      console.error('Codex token refresh failed:', response.status, await response.text());
      return null;
    }

    const tokens = await response.json() as {
      access_token: string;
      id_token: string;
      refresh_token?: string;
    };

    const updated: CodexAuth = {
      ...auth,
      tokens: {
        access_token: tokens.access_token,
        id_token: tokens.id_token,
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

function mapCodexUsage(data: CodexUsageResponse | null): {
  fiveHour?: { utilization: number; resetsAt: string | null } | null;
  sevenDay?: { utilization: number; resetsAt: string | null } | null;
  sevenDaySonnet?: { utilization: number; resetsAt: string | null } | null;
} {
  if (!data) return {};
  const root = data.data ?? data;
  const fiveHour = root.five_hour;
  const sevenDay = root.seven_day;
  const sevenDayOpus = root.seven_day_opus;

  if (fiveHour || sevenDay || sevenDayOpus) {
    return {
      fiveHour: fiveHour ? { utilization: normalizePercent(fiveHour.utilization), resetsAt: fiveHour.resets_at ?? null } : null,
      sevenDay: sevenDay ? { utilization: normalizePercent(sevenDay.utilization), resetsAt: sevenDay.resets_at ?? null } : null,
      sevenDaySonnet: sevenDayOpus ? { utilization: normalizePercent(sevenDayOpus.utilization), resetsAt: sevenDayOpus.resets_at ?? null } : null,
    };
  }

  const limits = root.limits || [];
  const findLimit = (predicate: (item: CodexLimitItem) => boolean) => limits.find(predicate);

  const sessionLimit = findLimit(item => (item.type || '').toLowerCase().includes('session') || (item.type || '').toLowerCase().includes('five'));
  const weeklyLimit = findLimit(item => (item.type || '').toLowerCase().includes('week'));
  const sonnetLimit = findLimit(item => (item.type || '').toLowerCase().includes('sonnet'));

  return {
    fiveHour: sessionLimit ? { utilization: normalizePercent(sessionLimit.percentage ?? sessionLimit.utilization), resetsAt: sessionLimit.resets_at ?? null } : null,
    sevenDay: weeklyLimit ? { utilization: normalizePercent(weeklyLimit.percentage ?? weeklyLimit.utilization), resetsAt: weeklyLimit.resets_at ?? null } : null,
    sevenDaySonnet: sonnetLimit ? { utilization: normalizePercent(sonnetLimit.percentage ?? sonnetLimit.utilization), resetsAt: sonnetLimit.resets_at ?? null } : null,
  };
}

async function fetchCodexUsage(auth: CodexAuth): Promise<CodexUsageResponse | null> {
  const accessToken = auth.tokens?.access_token;
  const cookie = process.env.CODEX_USAGE_COOKIE || process.env.CODEX_SESSION_COOKIE || '';
  const userAgent = process.env.CODEX_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const url = process.env.CODEX_USAGE_URL || 'https://chatgpt.com/backend-api/codex/usage';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': userAgent,
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Codex usage error: ${response.status} ${errorText}`);
  }

  return await response.json() as CodexUsageResponse;
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

      const tokens = await response.json() as {
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
async function fetchUsage(accessToken: string): Promise<{ ok: boolean; status: number; data?: UsageLimitResponse; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code-webui/1.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, status: response.status, error: errorText };
    }

    const data = await response.json() as UsageLimitResponse;
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
    const allowedProviders: CLIProvider[] = ['claude', 'codex', 'opencode'];
    const provider = allowedProviders.includes(providerParam as CLIProvider)
      ? (providerParam as CLIProvider)
      : 'claude';

    if (provider === 'codex') {
      let codexAuth = await getCodexAuth();
      if (!codexAuth?.tokens?.access_token) {
        return res.json({
          success: false,
          supported: false,
          provider: 'codex',
          data: null,
          error: { code: 'NO_CREDENTIALS', message: 'Codex credentials not found' },
        });
      }

      try {
        let usage = await fetchCodexUsage(codexAuth);
        if (!usage) {
          return res.json({ success: true, supported: false, provider: 'codex', data: null });
        }

        const mapped = mapCodexUsage(usage);
        res.json({
          success: true,
          supported: true,
          provider: 'codex',
          data: {
            subscriptionType: 'codex',
            rateLimitTier: 'codex',
            fiveHour: mapped.fiveHour ?? null,
            sevenDay: mapped.sevenDay ?? null,
            sevenDaySonnet: mapped.sevenDaySonnet ?? null,
          },
        });
      } catch (err) {
        const errorText = String(err);
        const isAuthError = errorText.includes('401') || errorText.includes('403');
        if (isAuthError) {
          const refreshed = await refreshCodexToken(codexAuth);
          if (refreshed?.tokens?.access_token) {
            try {
              const usage = await fetchCodexUsage(refreshed);
              const mapped = mapCodexUsage(usage);
              return res.json({
                success: true,
                supported: true,
                provider: 'codex',
                data: {
                  subscriptionType: 'codex',
                  rateLimitTier: 'codex',
                  fiveHour: mapped.fiveHour ?? null,
                  sevenDay: mapped.sevenDay ?? null,
                  sevenDaySonnet: mapped.sevenDaySonnet ?? null,
                },
              });
            } catch (retryErr) {
              console.error('Codex usage retry error:', retryErr);
            }
          }
        }

        if (isAuthError) {
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
            message: 'Failed to fetch Codex usage. Provide CODEX_USAGE_COOKIE or CODEX_USAGE_URL if required.',
          },
        });
      }
      return;
    }

    if (provider !== 'claude') {
      return res.json({
        success: true,
        supported: false,
        provider,
        data: null,
      });
    }

    let credentials = await getClaudeCredentials();

    if (!credentials?.claudeAiOauth?.accessToken) {
      return res.json({
        success: false,
        supported: false,
        provider: 'claude',
        data: null,
        error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found' }
      });
    }

    let { accessToken, refreshToken, subscriptionType, rateLimitTier } = credentials.claudeAiOauth;

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
          error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found or expired' }
        });
      }
      console.error('Claude API error:', result.status, result.error);
      return res.status(result.status).json({
        success: false,
        error: { code: 'API_ERROR', message: `Claude API error: ${result.status}` }
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
        fiveHour: usageData.five_hour ? {
          utilization: usageData.five_hour.utilization,
          resetsAt: usageData.five_hour.resets_at,
        } : null,
        sevenDay: usageData.seven_day ? {
          utilization: usageData.seven_day.utilization,
          resetsAt: usageData.seven_day.resets_at,
        } : null,
        sevenDaySonnet: usageData.seven_day_opus ? {
          utilization: usageData.seven_day_opus.utilization,
          resetsAt: usageData.seven_day_opus.resets_at,
        } : null,
      },
    });
  } catch (err) {
    console.error('Failed to fetch usage limits:', err);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch usage limits' }
    });
  }
});

export default router;
