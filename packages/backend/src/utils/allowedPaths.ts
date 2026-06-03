import path from 'path';
import fs from 'fs';
import { config } from '../config';

export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relativePath = path.relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return null;
  }
}

function nearestExistingRealpath(filePath: string): string | null {
  let current = path.resolve(filePath);

  while (true) {
    const real = realpathIfExists(current);
    if (real) return real;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function isAllowedBasePath(filePath: string): boolean {
  const target = path.resolve(filePath);

  return config.allowedBasePaths.some((base) => {
    if (!base.trim()) return false;

    const resolvedBase = path.resolve(base);
    if (!isPathInside(resolvedBase, target)) return false;

    const baseReal = realpathIfExists(resolvedBase);
    const targetReal = nearestExistingRealpath(target);
    if (!baseReal || !targetReal) return false;

    return isPathInside(baseReal, targetReal);
  });
}
