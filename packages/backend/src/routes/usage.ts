import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = Router();
const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

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

// Get Claude credentials from ~/.claude/.credentials.json
async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Refresh Claude OAuth token
async function refreshClaudeToken(refreshToken: string): Promise<ClaudeCredentials | null> {
  try {
    const response = await fetch('https://console.anthropic.com/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
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

    await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
    console.log('Claude token refreshed successfully');
    return updated;
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

// Fetch usage limits from Claude API
router.get('/limits', requireAuth, async (_req, res) => {
  try {
    let credentials = await getClaudeCredentials();

    if (!credentials?.claudeAiOauth?.accessToken) {
      return res.status(401).json({
        success: false,
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
