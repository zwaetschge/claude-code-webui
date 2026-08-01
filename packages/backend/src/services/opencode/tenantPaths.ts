import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface OpenCodeTenantPaths {
  tenantKey: string;
  rootDir: string;
  configDir: string;
  dataDir: string;
  sessionContextFile: string;
}

function tenantKeyForUser(userId: string): string {
  if (!userId.trim()) {
    throw new Error('OpenCode tenant requires a WebUI user id');
  }
  return createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

export function resolveOpenCodeTenantPaths(
  userId: string,
  opts: { persistentRoot?: string; runtimeRoot?: string } = {}
): OpenCodeTenantPaths {
  const tenantKey = tenantKeyForUser(userId);
  const persistentRoot =
    opts.persistentRoot ||
    process.env.OPENCODE_TENANT_ROOT ||
    path.join(os.homedir(), '.opencode', 'users');
  const runtimeRoot =
    opts.runtimeRoot ||
    process.env.OPENCODE_TENANT_RUNTIME_ROOT ||
    path.join(os.tmpdir(), 'plum-opencode-users');
  const rootDir = path.join(persistentRoot, tenantKey);

  return {
    tenantKey,
    rootDir,
    configDir: path.join(rootDir, 'config'),
    dataDir: path.join(rootDir, 'share'),
    sessionContextFile: path.join(runtimeRoot, tenantKey, 'webui-session.json'),
  };
}

export function ensureOpenCodeTenantDirectories(paths: OpenCodeTenantPaths): void {
  for (const directory of [
    paths.rootDir,
    paths.configDir,
    paths.dataDir,
    path.dirname(paths.sessionContextFile),
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(directory, 0o700);
    } catch {
      // Best effort on filesystems that do not implement POSIX permissions.
    }
  }
}
