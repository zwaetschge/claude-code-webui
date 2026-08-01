const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

export interface ClaudeOAuthRefreshTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  refreshTokenExpiresIn: number | null;
}

export async function requestClaudeOAuthTokenRefresh(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<ClaudeOAuthRefreshTokens> {
  const response = await fetchImpl(CLAUDE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'anthropic-beta': CLAUDE_OAUTH_BETA,
      'User-Agent': 'plum-code-webui/1.0',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_CODE_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude OAuth token refresh failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    refresh_token_expires_in?: unknown;
  };
  const expiresIn = Number(body.expires_in);
  if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(expiresIn)) {
    throw new Error('Claude OAuth token refresh returned an invalid response');
  }

  const refreshTokenExpiresIn = Number(body.refresh_token_expires_in);
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    expiresIn,
    refreshTokenExpiresIn: Number.isFinite(refreshTokenExpiresIn) ? refreshTokenExpiresIn : null,
  };
}
