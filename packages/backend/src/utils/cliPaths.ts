import os from 'os';
import path from 'path';

const DEFAULT_NPM_PREFIX = '.npm-global';

export function getNpmPrefix(): string {
  return process.env.NPM_CONFIG_PREFIX || path.join(os.homedir(), DEFAULT_NPM_PREFIX);
}

export function ensureCliPath(): string {
  const prefix = getNpmPrefix();
  const binDir = path.join(prefix, 'bin');
  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(':').filter((part) => part.length > 0);

  if (!pathParts.includes(binDir)) {
    process.env.PATH = [binDir, ...pathParts].join(':');
  }
  if (!process.env.NPM_CONFIG_PREFIX) {
    process.env.NPM_CONFIG_PREFIX = prefix;
  }

  return prefix;
}

export function getCliEnvForPrefix(prefix: string): NodeJS.ProcessEnv {
  const binDir = path.join(prefix, 'bin');
  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(':').filter((part) => part.length > 0);
  const nextPath = pathParts.includes(binDir) ? currentPath : [binDir, ...pathParts].join(':');

  return {
    ...process.env,
    NPM_CONFIG_PREFIX: prefix,
    PATH: nextPath,
  };
}

export function getCliEnv(): NodeJS.ProcessEnv {
  const prefix = ensureCliPath();
  return getCliEnvForPrefix(prefix);
}
