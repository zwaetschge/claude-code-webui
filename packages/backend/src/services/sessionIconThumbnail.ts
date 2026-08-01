import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SESSION_ICON_THUMBNAIL_SIZES = [32, 64, 96, 128, 256] as const;

export type SessionIconThumbnailSize = (typeof SESSION_ICON_THUMBNAIL_SIZES)[number];

const allowedSizes = new Set<number>(SESSION_ICON_THUMBNAIL_SIZES);
const thumbnailJobs = new Map<string, Promise<string>>();
const THUMBNAIL_TIMEOUT_MS = 10_000;
const MAX_ERROR_OUTPUT_CHARS = 4_000;

export function sessionIconCacheControl(options: {
  versioned: boolean;
  thumbnailFallback?: boolean;
}): string {
  if (options.thumbnailFallback) return 'private, max-age=60';
  return options.versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=3600';
}

export function parseSessionIconThumbnailSize(value: unknown): SessionIconThumbnailSize | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const size = Number(value);
  return allowedSizes.has(size) ? (size as SessionIconThumbnailSize) : null;
}

export function sessionIconThumbnailPath(iconPath: string, size: SessionIconThumbnailSize): string {
  const ext = path.extname(iconPath);
  const basename = ext ? iconPath.slice(0, -ext.length) : iconPath;
  return `${basename}.thumb-${size}.webp`;
}

async function isFreshThumbnail(iconPath: string, thumbnailPath: string): Promise<boolean> {
  const [source, thumbnail] = await Promise.all([
    fs.stat(iconPath),
    fs.stat(thumbnailPath).catch(() => null),
  ]);
  return Boolean(thumbnail?.isFile() && thumbnail.size > 0 && thumbnail.mtimeMs >= source.mtimeMs);
}

async function runImageMagick(
  iconPath: string,
  outputPath: string,
  size: SessionIconThumbnailSize
): Promise<void> {
  const args = [
    '-limit',
    'thread',
    '1',
    '-limit',
    'memory',
    '64MiB',
    '-limit',
    'map',
    '128MiB',
    '-limit',
    'disk',
    '128MiB',
    `${iconPath}[0]`,
    '-auto-orient',
    '-thumbnail',
    `${size}x${size}^`,
    '-gravity',
    'center',
    '-extent',
    `${size}x${size}`,
    '-strip',
    '-quality',
    '82',
    '-define',
    'webp:method=4',
    `webp:${outputPath}`,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.IMAGEMAGICK_BIN || 'magick', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        MAGICK_THREAD_LIMIT: '1',
        MAGICK_TEMPORARY_PATH: path.dirname(outputPath),
      },
    });
    let errorOutput = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new Error(`Session icon thumbnail conversion timed out after ${THUMBNAIL_TIMEOUT_MS}ms`)
      );
    }, THUMBNAIL_TIMEOUT_MS);
    timeout.unref();

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (errorOutput.length < MAX_ERROR_OUTPUT_CHARS) {
        errorOutput += chunk.toString().slice(0, MAX_ERROR_OUTPUT_CHARS - errorOutput.length);
      }
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = errorOutput.trim();
      finish(
        new Error(
          `Session icon thumbnail conversion failed (${signal ?? code ?? 'unknown'})${
            detail ? `: ${detail}` : ''
          }`
        )
      );
    });
  });
}

async function createSessionIconThumbnail(
  iconPath: string,
  thumbnailPath: string,
  size: SessionIconThumbnailSize
): Promise<string> {
  if (await isFreshThumbnail(iconPath, thumbnailPath)) return thumbnailPath;

  const temporaryPath = `${thumbnailPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await runImageMagick(iconPath, temporaryPath, size);
    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('Session icon thumbnail conversion produced an empty file');
    }
    await fs.rename(temporaryPath, thumbnailPath);
    return thumbnailPath;
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function ensureSessionIconThumbnail(
  iconPath: string,
  size: SessionIconThumbnailSize
): Promise<string> {
  const thumbnailPath = sessionIconThumbnailPath(iconPath, size);
  if (await isFreshThumbnail(iconPath, thumbnailPath)) return thumbnailPath;

  const key = `${thumbnailPath}:${size}`;
  const existing = thumbnailJobs.get(key);
  if (existing) return existing;

  const job = createSessionIconThumbnail(iconPath, thumbnailPath, size);
  thumbnailJobs.set(key, job);
  try {
    return await job;
  } finally {
    if (thumbnailJobs.get(key) === job) thumbnailJobs.delete(key);
  }
}
