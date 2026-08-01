import fs from 'fs';
import path from 'path';

import { getDatabase } from '../db/index.js';
import { resolveConfigHome } from '../utils/configPaths.js';

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: Record<string, ReadinessCheck>;
}

function checkDirectory(directory: string): ReadinessCheck {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, detail: 'directory is not readable and writable' };
  }
}

function checkFrontendBundle(frontendPath: string): ReadinessCheck {
  const indexPath = path.join(frontendPath, 'index.html');
  try {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const assetPaths = Array.from(
      indexHtml.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g),
      (match) => match[1] as string
    );

    if (!assetPaths.some((assetPath) => assetPath.endsWith('.js'))) {
      return { ok: false, detail: 'frontend entry script is missing' };
    }
    if (!assetPaths.some((assetPath) => assetPath.endsWith('.css'))) {
      return { ok: false, detail: 'frontend stylesheet is missing' };
    }

    const frontendRoot = path.resolve(frontendPath);
    for (const assetPath of new Set(assetPaths)) {
      const resolvedAsset = path.resolve(frontendRoot, `.${assetPath}`);
      if (!resolvedAsset.startsWith(`${frontendRoot}${path.sep}`)) {
        return { ok: false, detail: 'frontend asset path is invalid' };
      }
      const assetStats = fs.statSync(resolvedAsset);
      if (!assetStats.isFile() || assetStats.size === 0) {
        return { ok: false, detail: `frontend asset is empty: ${assetPath}` };
      }
    }

    return { ok: true };
  } catch (error) {
    const detail =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'frontend bundle or referenced asset is missing'
        : 'frontend bundle cannot be read';
    return { ok: false, detail };
  }
}

/**
 * Readiness is intentionally local and bounded. External providers, MCPs and
 * optional integrations are not dependencies of the WebUI control plane and
 * must not flap the container when one of them is offline.
 */
export function buildReadinessReport(frontendPath?: string): ReadinessReport {
  const checks: Record<string, ReadinessCheck> = {};

  try {
    getDatabase().prepare('SELECT 1 AS ok').get();
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, detail: 'database query failed' };
  }

  const dataDirectory = process.env.WEBUI_DATA_DIR
    ? path.resolve(process.env.WEBUI_DATA_DIR)
    : path.resolve(process.cwd(), 'packages/backend/data');
  checks.dataDirectory = checkDirectory(dataDirectory);
  checks.configHome = checkDirectory(resolveConfigHome());

  if (frontendPath) {
    checks.frontend = checkFrontendBundle(frontendPath);
  }

  return {
    status: Object.values(checks).every((check) => check.ok) ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
  };
}
