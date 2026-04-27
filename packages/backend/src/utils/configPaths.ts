import os from 'os';
import path from 'path';

const CLAUDE_CONFIG_OVERRIDE = process.env.WEBUI_CONFIG_HOME || process.env.CLAUDE_CONFIG_HOME;

export function resolveConfigHome(_provider?: unknown): string {
  const homeDir = os.homedir();

  return CLAUDE_CONFIG_OVERRIDE
    ? path.resolve(CLAUDE_CONFIG_OVERRIDE)
    : path.join(homeDir, '.claude');
}
