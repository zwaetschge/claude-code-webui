import { Router } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import type { User } from '@claude-code-webui/shared';

const router = Router();

// Generate JWT token
function generateToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: '7d' });
}

// GitHub OAuth (only if configured)
if (config.github.clientId && config.github.clientSecret && config.github.callbackUrl) {
  router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));

  router.get(
    '/github/callback',
    passport.authenticate('github', { failureRedirect: `${config.frontendUrl}/login?error=github` }),
    (req, res) => {
      const user = req.user as User;
      const token = generateToken(user.id);
      res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    }
  );
} else {
  router.get('/github', (_req, res) => {
    res.redirect(`${config.frontendUrl}/login?error=github`);
  });
}

// Google OAuth (only if configured)
if (config.google.clientId && config.google.clientSecret && config.google.callbackUrl) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: `${config.frontendUrl}/login?error=google` }),
    (req, res) => {
      const user = req.user as User;
      const token = generateToken(user.id);
      res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    }
  );
} else {
  router.get('/google', (_req, res) => {
    res.redirect(`${config.frontendUrl}/login?error=google`);
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
    const response = await fetch('https://console.anthropic.com/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Claude Code client ID
      }),
    });

    if (!response.ok) {
      console.error('Token refresh failed:', await response.text());
      return null;
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
  } catch (err) {
    console.error('Token refresh error:', err);
    return null;
  }
}

if (config.claude.oauthEnabled) {
  // Login using existing Claude CLI credentials
  router.get('/claude', async (_req, res) => {
    try {
      let credentials = await getClaudeCredentials();

      if (!credentials?.claudeAiOauth?.accessToken) {
        return res.redirect(`${config.frontendUrl}/login?error=claude_not_logged_in`);
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

      const db = getDatabase();

      // Find or create user
      let user = db
        .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
        .get('claude', 'local-cli') as User | undefined;

      if (!user) {
        const userId = nanoid();
        db.prepare(
          `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
           VALUES (?, ?, ?, ?, 'claude', 'local-cli')`
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
          provider: 'claude',
          providerId: 'local-cli',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as User;
      } else {
        // Update user info
        db.prepare('UPDATE users SET email = ?, name = ? WHERE id = ?').run(email, name, user.id);
        user.email = email;
        user.name = name;
      }

      const token = generateToken(user.id);
      res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error('Claude CLI auth error:', error);
      res.redirect(`${config.frontendUrl}/login?error=claude`);
    }
  });
} else {
  router.get('/claude', (_req, res) => {
    res.redirect(`${config.frontendUrl}/login?error=claude`);
  });
}

// Dev login (only in development mode)
if (config.isDevelopment) {
  router.post('/dev-login', (req, res) => {
    const { email = 'dev@localhost', name = 'Dev User' } = req.body;
    const db = getDatabase();

    // Find or create dev user
    let user = db
      .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
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

    const token = generateToken(user.id);
    res.json({ success: true, data: { token, user } });
  });

  // Quick dev login redirect
  router.get('/dev', (_req, res) => {
    const db = getDatabase();

    // Find or create dev user
    let user = db
      .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
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

    const token = generateToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  });
}

// Get current user
router.get('/me', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const user = db.prepare(`
    SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
           created_at as createdAt, updated_at as updatedAt
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
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
router.get('/providers', (_req, res) => {
  res.json({
    success: true,
    data: {
      github: !!(config.github.clientId && config.github.clientSecret),
      google: !!(config.google.clientId && config.google.clientSecret),
      claude: config.claude.oauthEnabled,
    },
  });
});

export default router;
