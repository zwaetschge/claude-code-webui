import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CLI_PROVIDERS } from '../services/cli-providers';

const codexCredentialsRoot = CLI_PROVIDERS.codex.credentialsPath;
const codexAuthPath = path.join(codexCredentialsRoot.replace('~', os.homedir()), 'auth.json');

export interface CodexAuthTokens {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  // account_id is sometimes stored directly in tokens by recent codex versions;
  // older versions only carry it inside the id_token JWT claims.
  account_id?: string;
}

export interface CodexAuth {
  OPENAI_API_KEY?: string | null;
  tokens?: CodexAuthTokens;
  last_refresh?: string;
}

// OAuth client id used by the codex CLI for token refresh. Matches the upstream
// `wakamex/codex-cli-usage` reference implementation. Using the JWT `aud` claim
// instead fails because Codex's refresh endpoint rejects mismatched client IDs.
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// Real Codex usage response shape from /backend-api/codex/usage.
export interface CodexWindow {
  used_percent?: number;
  reset_at?: number; // unix epoch seconds
  limit_window_seconds?: number;
}

export interface CodexAdditionalLimit {
  limit_name?: string;
  rate_limit?: CodexWindow;
}

export interface CodexUsageApiResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
  additional_rate_limits?: CodexAdditionalLimit[];
}

export interface MappedCodexWindow {
  utilization: number;
  resetsAt: string | null;
  windowSeconds: number | null;
}

export async function getCodexAuth(): Promise<CodexAuth | null> {
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

export async function refreshCodexToken(auth: CodexAuth): Promise<CodexAuth | null> {
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

export function isCodexUsageAuthError(err: unknown): boolean {
  const errorText = String(err);
  return errorText.includes('401') || errorText.includes('403');
}

export async function fetchCodexUsage(auth: CodexAuth): Promise<CodexUsageApiResponse | null> {
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

export function mapCodexWindow(window?: CodexWindow): MappedCodexWindow | null {
  if (!window) return null;
  const pct = normalizePercent(window.used_percent);
  const resetsAt =
    typeof window.reset_at === 'number' ? new Date(window.reset_at * 1000).toISOString() : null;
  const windowSeconds =
    typeof window.limit_window_seconds === 'number' ? window.limit_window_seconds : null;
  return { utilization: pct, resetsAt, windowSeconds };
}

export function mapCodexUsage(data: CodexUsageApiResponse | null): {
  plan: string | null;
  fiveHour: MappedCodexWindow | null;
  sevenDay: MappedCodexWindow | null;
  additional: Array<{ name: string } & MappedCodexWindow>;
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
        ...window,
      };
    })
    .filter((x): x is { name: string } & MappedCodexWindow => x !== null);

  return {
    plan: data.plan_type ?? null,
    fiveHour: mapCodexWindow(rl?.primary_window),
    sevenDay: mapCodexWindow(rl?.secondary_window),
    additional,
  };
}
