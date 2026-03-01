import os from 'os';
import path from 'path';

const CLAUDE_SHARED_PROVIDERS = new Set(['claude', 'codex']);
const GLM_PROVIDERS = new Set(['glm', 'zai']);
const CLAUDE_CONFIG_OVERRIDE = process.env.WEBUI_CONFIG_HOME || process.env.CLAUDE_CONFIG_HOME;
const GLM_CONFIG_OVERRIDE = process.env.WEBUI_GLM_CONFIG_HOME || process.env.GLM_CONFIG_HOME;
const GEMINI_CONFIG_OVERRIDE = process.env.WEBUI_GEMINI_CONFIG_HOME || process.env.GEMINI_CONFIG_HOME;

function normalizeProvider(provider: unknown): string {
  if (typeof provider === 'string') return provider.toLowerCase();
  if (Array.isArray(provider) && typeof provider[0] === 'string') {
    return provider[0].toLowerCase();
  }
  return '';
}

export function resolveConfigHome(provider?: unknown): string {
  const normalized = normalizeProvider(provider);
  const homeDir = os.homedir();

  if (normalized === 'gemini') {
    return GEMINI_CONFIG_OVERRIDE
      ? path.resolve(GEMINI_CONFIG_OVERRIDE)
      : path.join(homeDir, '.gemini');
  }

  if (GLM_PROVIDERS.has(normalized)) {
    return GLM_CONFIG_OVERRIDE
      ? path.resolve(GLM_CONFIG_OVERRIDE)
      : path.join(homeDir, '.glm');
  }

  if (CLAUDE_SHARED_PROVIDERS.has(normalized)) {
    return CLAUDE_CONFIG_OVERRIDE
      ? path.resolve(CLAUDE_CONFIG_OVERRIDE)
      : path.join(homeDir, '.claude');
  }

  return CLAUDE_CONFIG_OVERRIDE
    ? path.resolve(CLAUDE_CONFIG_OVERRIDE)
    : path.join(homeDir, '.claude');
}
