import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { safeEncrypt, safeDecrypt } from '../utils/encryption.js';
import type { ApiResponse } from '@plum-code-webui/shared';

const router = Router();

// OAuth state storage (in production, use Redis or similar)
const oauthStates = new Map<
  string,
  { userId: string; providerType: string; providerId?: string; redirectUrl: string }
>();

// Clean up old states periodically
const oauthStateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, _value] of oauthStates.entries()) {
    // States older than 10 minutes are removed
    const stateTime = parseInt(key.split('_')[0] || '0');
    if (now - stateTime > 10 * 60 * 1000) {
      oauthStates.delete(key);
    }
  }
}, 60 * 1000);
oauthStateCleanupTimer.unref();

// Supported OAuth providers and their configurations
const OAUTH_CONFIGS: Record<
  string,
  {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnv: string;
    clientSecretEnv: string;
  }
> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // Gemini API scopes
    scopes: [
      'https://www.googleapis.com/auth/generative-language.retriever',
      'https://www.googleapis.com/auth/cloud-platform',
    ],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
};

// Get OAuth URL for a provider type
router.get('/oauth/:providerType/url', requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const providerType = req.params.providerType as string;
  const { providerId, redirectUrl } = req.query;

  const oauthConfig = OAUTH_CONFIGS[providerType];
  if (!oauthConfig) {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: `OAuth not supported for provider type: ${providerType}`,
      },
    };
    return res.status(400).json(response);
  }

  const clientId =
    providerType === 'google' ? config.google.clientId : process.env[oauthConfig.clientIdEnv];
  if (!clientId) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'NOT_CONFIGURED', message: `OAuth not configured for ${providerType}` },
    };
    return res.status(400).json(response);
  }

  // Generate state for CSRF protection
  const state = `${Date.now()}_${nanoid()}`;
  oauthStates.set(state, {
    userId: authReq.userId,
    providerType,
    providerId: providerId as string | undefined,
    redirectUrl: (redirectUrl as string) || '/settings?tab=providers',
  });

  // Build OAuth URL
  const callbackUrl = `${config.frontendUrl.replace(/\/$/, '')}/api/providers/oauth/${providerType}/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: oauthConfig.scopes.join(' '),
    state,
    access_type: 'offline', // Get refresh token
    prompt: 'consent', // Force consent screen to get refresh token
  });

  const response: ApiResponse<{ url: string }> = {
    success: true,
    data: { url: `${oauthConfig.authUrl}?${params.toString()}` },
  };
  res.json(response);
});

// OAuth callback handler
router.get('/oauth/:providerType/callback', async (req, res) => {
  const { providerType } = req.params;
  const { code, state, error } = req.query;

  // Handle OAuth errors
  if (error) {
    return res.redirect(`/settings?tab=providers&error=${encodeURIComponent(error as string)}`);
  }

  // Validate state
  const stateData = oauthStates.get(state as string);
  if (!stateData) {
    return res.redirect('/settings?tab=providers&error=invalid_state');
  }
  oauthStates.delete(state as string);

  const oauthConfig = OAUTH_CONFIGS[providerType];
  if (!oauthConfig) {
    return res.redirect('/settings?tab=providers&error=unsupported_provider');
  }

  try {
    // Exchange code for tokens
    const clientId =
      providerType === 'google' ? config.google.clientId : process.env[oauthConfig.clientIdEnv];
    const clientSecret =
      providerType === 'google'
        ? config.google.clientSecret
        : process.env[oauthConfig.clientSecretEnv];
    const callbackUrl = `${config.frontendUrl.replace(/\/$/, '')}/api/providers/oauth/${providerType}/callback`;

    const tokenResponse = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('OAuth token exchange failed:', errorText);
      return res.redirect('/settings?tab=providers&error=token_exchange_failed');
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const db = getDatabase();
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Tokens go into the same DB as API keys — encrypt them at rest so a DB
    // exfil does not yield long-lived Google refresh tokens in cleartext.
    const encryptedAccess = safeEncrypt(tokens.access_token);
    const encryptedRefresh = safeEncrypt(tokens.refresh_token || null);

    if (stateData.providerId) {
      // Update existing provider with OAuth tokens
      db.prepare(
        `
        UPDATE ai_providers SET
          oauth_access_token = ?,
          oauth_refresh_token = ?,
          oauth_expires_at = ?,
          auth_method = 'oauth',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `
      ).run(encryptedAccess, encryptedRefresh, expiresAt, stateData.providerId, stateData.userId);
    } else {
      // Create new provider with OAuth tokens
      const id = nanoid();
      const providerName =
        providerType === 'google' ? 'Google Gemini (OAuth)' : `${providerType} (OAuth)`;

      db.prepare(
        `
        INSERT INTO ai_providers (id, user_id, name, type, auth_method, oauth_access_token, oauth_refresh_token, oauth_expires_at)
        VALUES (?, ?, ?, ?, 'oauth', ?, ?, ?)
      `
      ).run(
        id,
        stateData.userId,
        providerName,
        providerType,
        encryptedAccess,
        encryptedRefresh,
        expiresAt
      );
    }

    res.redirect(`${stateData.redirectUrl}&oauth_success=true`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/settings?tab=providers&error=oauth_error');
  }
});

// Refresh OAuth token for a provider
router.post('/:id/refresh-token', requireAuth, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const db = getDatabase();
  const { id } = req.params;

  try {
    const provider = db
      .prepare(
        `
      SELECT id, type, oauth_refresh_token FROM ai_providers WHERE id = ? AND user_id = ?
    `
      )
      .get(id, authReq.userId) as
      | {
          id: string;
          type: string;
          oauth_refresh_token: string | null;
        }
      | undefined;

    if (!provider) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Provider not found' },
      };
      return res.status(404).json(response);
    }

    const refreshToken = safeDecrypt(provider.oauth_refresh_token);
    if (!refreshToken) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token available' },
      };
      return res.status(400).json(response);
    }

    const oauthConfig = OAUTH_CONFIGS[provider.type];
    if (!oauthConfig) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'UNSUPPORTED_PROVIDER', message: 'OAuth not supported for this provider' },
      };
      return res.status(400).json(response);
    }

    const clientId =
      provider.type === 'google' ? config.google.clientId : process.env[oauthConfig.clientIdEnv];
    const clientSecret =
      provider.type === 'google'
        ? config.google.clientSecret
        : process.env[oauthConfig.clientSecretEnv];

    const tokenResponse = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'REFRESH_FAILED', message: 'Failed to refresh token' },
      };
      return res.status(400).json(response);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    db.prepare(
      `
      UPDATE ai_providers SET
        oauth_access_token = ?,
        oauth_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(safeEncrypt(tokens.access_token), expiresAt, id);

    const response: ApiResponse<{ success: boolean }> = {
      success: true,
      data: { success: true },
    };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'REFRESH_ERROR', message: 'Failed to refresh token' },
    };
    res.status(500).json(response);
  }
});

// Check which OAuth providers are configured
router.get('/oauth/available', requireAuth, (_req, res) => {
  const available: Record<string, boolean> = {};

  for (const [providerType, oauthConfig] of Object.entries(OAUTH_CONFIGS)) {
    const clientId =
      providerType === 'google' ? config.google.clientId : process.env[oauthConfig.clientIdEnv];
    const clientSecret =
      providerType === 'google'
        ? config.google.clientSecret
        : process.env[oauthConfig.clientSecretEnv];
    available[providerType] = !!(clientId && clientSecret);
  }

  const response: ApiResponse<typeof available> = {
    success: true,
    data: available,
  };
  res.json(response);
});

export default router;
