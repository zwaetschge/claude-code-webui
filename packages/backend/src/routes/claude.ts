import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { requireAuth } from '../middleware/auth';

const execAsync = promisify(exec);
const router = Router();

interface ClaudeStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
}

async function checkClaudeInstalled(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execAsync('claude --version', { timeout: 5000 });
    const version = stdout.trim();
    return { installed: true, version };
  } catch {
    // Try checking if claude exists in PATH
    try {
      await execAsync('which claude', { timeout: 5000 });
      return { installed: true };
    } catch {
      return { installed: false };
    }
  }
}

function checkClaudeAuthenticated(): boolean {
  // Claude Code stores credentials in ~/.claude/.credentials.json
  const claudeDir = join(homedir(), '.claude');

  if (!existsSync(claudeDir)) {
    return false;
  }

  // Check for .credentials.json (the actual file used by Claude Code)
  const dotCredentialsJsonPath = join(claudeDir, '.credentials.json');
  if (existsSync(dotCredentialsJsonPath)) {
    try {
      const content = readFileSync(dotCredentialsJsonPath, 'utf-8');
      const credentials = JSON.parse(content);
      // Check if there's valid auth data (claudeAiOauth is used for browser auth)
      return !!(
        credentials.claudeAiOauth?.accessToken ||
        credentials.accessToken ||
        credentials.refreshToken ||
        credentials.apiKey
      );
    } catch {
      return false;
    }
  }

  return false;
}

// POST /api/claude/authenticate - Start Claude authentication process
router.post('/authenticate', requireAuth, async (_req, res) => {
  try {
    // Run claude with --dangerously-skip-permissions to trigger OAuth flow
    // The CLI will output a URL that needs to be opened in a browser
    const { stdout, stderr } = await execAsync('claude auth login 2>&1 || claude --dangerously-skip-permissions 2>&1', {
      timeout: 10000,
      env: { ...process.env, CLAUDE_CODE_HEADLESS: '1' },
    });

    const output = stdout || stderr;

    // Look for OAuth URL in output
    const urlMatch = output.match(/https:\/\/[^\s]+/);
    if (urlMatch) {
      res.json({
        success: true,
        data: {
          authUrl: urlMatch[0],
          message: 'Open this URL in your browser to authenticate',
        },
      });
    } else {
      // Maybe already authenticated or no URL found
      res.json({
        success: true,
        data: {
          message: output.trim() || 'Authentication process started. Check if already authenticated.',
        },
      });
    }
  } catch (error) {
    console.error('Error starting Claude auth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start authentication process',
    });
  }
});

// GET /api/claude/status - Check Claude CLI installation and authentication
router.get('/status', requireAuth, async (_req, res) => {
  try {
    const installStatus = await checkClaudeInstalled();
    const authenticated = installStatus.installed ? checkClaudeAuthenticated() : false;

    const status: ClaudeStatus = {
      installed: installStatus.installed,
      authenticated,
      version: installStatus.version,
    };

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error checking Claude status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check Claude status',
    });
  }
});

export default router;
