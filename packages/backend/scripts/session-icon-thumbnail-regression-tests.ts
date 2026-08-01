import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureSessionIconThumbnail,
  parseSessionIconThumbnailSize,
  sessionIconCacheControl,
  sessionIconThumbnailPath,
} from '../src/services/sessionIconThumbnail.js';
import { buildSessionIconSrc } from '../../frontend/src/lib/sessionIconUrl.js';

function runMagick(args: string[]): string {
  const result = spawnSync(process.env.IMAGEMAGICK_BIN || 'magick', args, {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `ImageMagick command failed: ${(result.stderr || result.error?.message || '').trim()}`
  );
  return result.stdout.trim();
}

assert.equal(parseSessionIconThumbnailSize('32'), 32);
assert.equal(parseSessionIconThumbnailSize('96'), 96);
assert.equal(parseSessionIconThumbnailSize('256'), 256);
for (const invalid of [undefined, '', '0', '48', '512', ['96']]) {
  assert.equal(parseSessionIconThumbnailSize(invalid), null);
}
assert.equal(sessionIconCacheControl({ versioned: true }), 'private, max-age=31536000, immutable');
assert.equal(sessionIconCacheControl({ versioned: false }), 'private, max-age=3600');
assert.equal(
  sessionIconCacheControl({ versioned: true, thumbnailFallback: true }),
  'private, max-age=60',
  'a transient conversion failure must not cache the large original as an immutable thumbnail'
);

assert.equal(
  buildSessionIconSrc('/api/sessions/session-1/icon?v=revision', 'jwt value', 96),
  '/api/sessions/session-1/icon?v=revision&size=96&token=jwt%20value'
);
assert.equal(
  buildSessionIconSrc('/api/sessions/session-1/icon', null, 64),
  '/api/sessions/session-1/icon?size=64'
);
assert.equal(
  buildSessionIconSrc('/api/sessions/session-1/icon', 'token', null),
  '/api/sessions/session-1/icon?token=token'
);
assert.equal(
  buildSessionIconSrc('https://cdn.example.test/icon.png', 'token', 96),
  'https://cdn.example.test/icon.png',
  'external icon URLs must remain unchanged'
);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-session-icon-thumbnail-'));
try {
  const originalPath = path.join(tempDir, 'session-1-original.png');
  runMagick(['-size', '1024x1024', 'gradient:#351057-#d896dd', originalPath]);
  const originalStat = await fs.stat(originalPath);

  const thumbnailPath = await ensureSessionIconThumbnail(originalPath, 96);
  const thumbnailStat = await fs.stat(thumbnailPath);
  assert.equal(thumbnailPath, sessionIconThumbnailPath(originalPath, 96));
  assert.equal(runMagick(['identify', '-format', '%wx%h', thumbnailPath]), '96x96');
  assert.ok(thumbnailStat.size < originalStat.size, 'thumbnail should be smaller than its source');

  const cachedPath = await ensureSessionIconThumbnail(originalPath, 96);
  const cachedStat = await fs.stat(cachedPath);
  assert.equal(cachedPath, thumbnailPath);
  assert.equal(
    cachedStat.mtimeMs,
    thumbnailStat.mtimeMs,
    'a fresh thumbnail must be reused without rewriting it'
  );

  await fs.unlink(thumbnailPath);
  const parallelPaths = await Promise.all([
    ensureSessionIconThumbnail(originalPath, 96),
    ensureSessionIconThumbnail(originalPath, 96),
    ensureSessionIconThumbnail(originalPath, 96),
  ]);
  assert.deepEqual(parallelPaths, [thumbnailPath, thumbnailPath, thumbnailPath]);
  assert.equal(runMagick(['identify', '-format', '%wx%h', thumbnailPath]), '96x96');

  const beforeRefresh = await fs.stat(thumbnailPath);
  await new Promise((resolve) => setTimeout(resolve, 25));
  runMagick(['-size', '1024x1024', 'gradient:#101827-#78d4ef', originalPath]);
  await ensureSessionIconThumbnail(originalPath, 96);
  const refreshed = await fs.stat(thumbnailPath);
  assert.ok(
    refreshed.mtimeMs > beforeRefresh.mtimeMs,
    'changing a source in place must refresh its cached thumbnail'
  );

  console.log(
    `session icon thumbnail regression tests passed (${originalStat.size}B -> ${thumbnailStat.size}B)`
  );
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
