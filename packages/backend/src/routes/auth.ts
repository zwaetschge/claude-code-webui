import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { rateLimiters } from '../middleware/rateLimiter';
import { getDatabase } from '../db';
import type { User } from '@claude-code-webui/shared';
import { isProviderAvailable } from '../services/cli-providers';
import { generateUserToken } from '../utils/authTokens';
import { upsertSharedCliUser } from '../utils/cliUser';
import { stampLogin } from '../utils/auditLog';
import { EmailNotAllowedError, OAuthEmailCollisionError } from '../auth/passport';

const router = Router();

// Wraps passport.authenticate so we can map OAuthEmailCollisionError to a user-friendly
// redirect instead of returning a 500.
function oauthCallbackHandler(
  strategy: 'github' | 'google'
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    passport.authenticate(
      strategy,
      (err: unknown, user: User | false) => {
        if (err) {
          if (err instanceof OAuthEmailCollisionError) {
            const params = new URLSearchParams({
              error: 'email_in_use',
              existing_provider: err.existingProvider,
            });
            return res.redirect(`${config.frontendUrl}/connect?${params.toString()}`);
          }
          if (err instanceof EmailNotAllowedError) {
            return res.redirect(`${config.frontendUrl}/connect?error=email_not_allowed`);
          }
          return res.redirect(`${config.frontendUrl}/connect?error=${strategy}`);
        }
        if (!user) {
          return res.redirect(`${config.frontendUrl}/connect?error=${strategy}`);
        }

        req.logIn(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          stampLogin(user.id, strategy, req);
          const token = generateUserToken(user.id);
          res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
        });
      }
    )(req, res, next);
  };
}

// GitHub OAuth (only if configured)
if (config.github.clientId && config.github.clientSecret && config.github.callbackUrl) {
  router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
  router.get('/github/callback', oauthCallbackHandler('github'));
} else {
  router.get('/github', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=github`);
  });
}

// Google OAuth (only if configured)
if (config.google.clientId && config.google.clientSecret && config.google.callbackUrl) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/google/callback', oauthCallbackHandler('google'));
} else {
  router.get('/google', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=google`);
  });
}

// Claude CLI credentials login (uses existing ~/.claude/.credentials.json)
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

const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

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
          client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Claude Code client ID
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

      // Save updated credentials
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

if (config.claude.oauthEnabled) {
  // Login using existing Claude CLI credentials
  router.get('/claude', async (req, res) => {
    try {
      let credentials = await getClaudeCredentials();

      if (!credentials?.claudeAiOauth?.accessToken) {
        return res.redirect(`${config.frontendUrl}/connect?error=claude_not_logged_in`);
      }

      // Check if token is expired and refresh if needed
      const { expiresAt, refreshToken } = credentials.claudeAiOauth;
      if (expiresAt && Date.now() > expiresAt - 60000) { // Refresh 1 min before expiry
        console.log('Token expired, refreshing...');
        const refreshed = await refreshClaudeToken(refreshToken);
        if (refreshed) {
          credentials = refreshed;
        }
      }

      const { accessToken, subscriptionType } = credentials.claudeAiOauth!;

      // Try to get user profile - use env var if set, otherwise try API
      let email = config.claude.userEmail || 'claude-user@local';
      let name = `Claude ${subscriptionType || 'User'}`;

      try {
        const userResponse = await fetch('https://api.anthropic.com/api/oauth/profile', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json() as { email?: string; name?: string };
          email = userData.email || email;
          name = userData.name || name;
        } else {
          console.log('Profile fetch failed:', userResponse.status, await userResponse.text());
        }
      } catch (err) {
        console.log('Profile fetch error:', err);
      }

      const user = upsertSharedCliUser(email, name);
      stampLogin(user.id, 'claude', req);
      const token = generateUserToken(user.id);
      res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error('Claude CLI auth error:', error);
      res.redirect(`${config.frontendUrl}/connect?error=claude`);
    }
  });
} else {
  router.get('/claude', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=claude`);
  });
}

// Codex CLI credentials login (uses ~/.codex presence)
router.get('/codex', async (req, res) => {
  try {
    const available = await isProviderAvailable('codex');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=codex_not_logged_in`);
    }

    const user = upsertSharedCliUser('codex-user@local', 'Codex User');
    stampLogin(user.id, 'codex', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('Codex CLI auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=codex`);
  }
});

// OpenCode CLI credentials login (uses ~/.config/opencode presence)
router.get('/opencode', async (req, res) => {
  try {
    const available = await isProviderAvailable('opencode');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=opencode_not_logged_in`);
    }

    const user = upsertSharedCliUser('opencode-user@local', 'OpenCode User');
    stampLogin(user.id, 'opencode', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('OpenCode CLI auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=opencode`);
  }
});

// Dev login (only in development mode)
if (config.isDevelopment) {
  router.post('/dev-login', rateLimiters.strict, (req, res) => {
    const { email = 'dev@localhost', name = 'Dev User' } = req.body;
    const db = getDatabase();

    // Find or create dev user
    let user = db
      .prepare(
        `SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
                created_at as createdAt, updated_at as updatedAt
         FROM users WHERE provider = ? AND provider_id = ?`
      )
      .get('dev', 'dev-user') as User | undefined;

    if (!user) {
      const userId = nanoid();
      db.prepare(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
         VALUES (?, ?, ?, ?, 'dev', 'dev-user')`
      ).run(userId, email, name, null);

      // Create default settings
      db.prepare(
        `INSERT INTO user_settings (user_id, theme, allowed_tools)
         VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
      ).run(userId);

      user = {
        id: userId,
        email,
        name,
        avatarUrl: null,
        provider: 'dev',
        providerId: 'dev-user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as User;
    }

    stampLogin(user.id, 'dev', req);
    const token = generateUserToken(user.id);
    res.json({ success: true, data: { token, user } });
  });

  // Quick dev login redirect
  router.get('/dev', (req, res) => {
    const db = getDatabase();

    // Find or create dev user
    let user = db
      .prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?')
      .get('dev', 'dev-user') as { id: string } | undefined;

    if (!user) {
      const userId = nanoid();
      db.prepare(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
         VALUES (?, 'dev@localhost', 'Dev User', NULL, 'dev', 'dev-user')`
      ).run(userId);

      db.prepare(
        `INSERT INTO user_settings (user_id, theme, allowed_tools)
         VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
      ).run(userId);

      user = { id: userId };
    }

    stampLogin(user.id, 'dev', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  });
}

// Get current user
router.get('/me', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const user = db.prepare(`
    SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
           role, status, last_login_at as lastLoginAt,
           created_at as createdAt, updated_at as updatedAt
    FROM users WHERE id = ?
  `).get(userId) as (User & { status?: string }) | undefined;

  if (!user) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  // Suspended users can authenticate but can't use the app — surface the status
  // here so the frontend can redirect them to a "suspended" screen instead of rendering
  // normal UI that'll just throw 403s on every subsequent request.
  if (user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
    });
  }

  res.json({ success: true, data: user });
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
});

// Auth providers info
router.get('/providers', async (_req, res) => {
  const [codexAvailable, opencodeAvailable] = await Promise.all([
    isProviderAvailable('codex'),
    isProviderAvailable('opencode'),
  ]);
  res.json({
    success: true,
    data: {
      github: !!(config.github.clientId && config.github.clientSecret),
      google: !!(config.google.clientId && config.google.clientSecret),
      claude: config.claude.oauthEnabled,
      codex: codexAvailable,
      opencode: opencodeAvailable,
    },
  });
});

export default router;
