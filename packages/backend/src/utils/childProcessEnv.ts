const INHERITED_CHILD_ENV_KEYS = [
  'HOME',
  'PATH',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const;

/**
 * Build an environment for user-configurable commands without copying the
 * backend's credentials (JWT/session/encryption keys, provider API tokens,
 * database configuration, hook secrets, etc.). Explicit per-tool values are
 * still honoured because they are part of that tool's own configuration.
 */
export function buildRestrictedChildEnv(
  explicit: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_CHILD_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  return { ...env, ...explicit };
}

export { INHERITED_CHILD_ENV_KEYS };
