import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Android in-app update channel. The client's AppUpdateChecker has called
 * GET /api/app/version since day one — this router finally answers it.
 *
 * Publishing a release means dropping two files into `<data>/android/`:
 *   claude-webui.apk   — the signed (or debug) APK
 *   version.json       — { "version": "1.1.0", "versionCode": 2, "releaseNotes": "…" }
 *
 * The download URL carries a short-lived HMAC token because Android's
 * DownloadManager fetches without the Authorization header.
 */
const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = process.env.WEBUI_DATA_DIR
  ? path.resolve(process.env.WEBUI_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const ANDROID_DIR = path.join(DATA_DIRECTORY, 'android');
const APK_PATH = path.join(ANDROID_DIR, 'claude-webui.apk');
const METADATA_PATH = path.join(ANDROID_DIR, 'version.json');

const DOWNLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', config.jwtSecret).update(payload).digest('hex');
}

function readMetadata(): { version: string; versionCode: number; releaseNotes?: string } | null {
  try {
    if (!fs.existsSync(APK_PATH) || !fs.existsSync(METADATA_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    if (typeof parsed.version !== 'string' || typeof parsed.versionCode !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

router.get('/version', requireAuth, (req: Request, res: Response) => {
  const metadata = readMetadata();
  if (!metadata) {
    return res.status(404).json({
      success: false,
      error: { message: 'No Android release published' },
    });
  }
  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const sig = sign(`apk.${metadata.versionCode}.${exp}`);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    success: true,
    data: {
      version: metadata.version,
      versionCode: metadata.versionCode,
      releaseNotes: metadata.releaseNotes ?? null,
      downloadUrl: `${base}/api/app/download?vc=${metadata.versionCode}&exp=${exp}&sig=${sig}`,
    },
  });
});

router.get('/download', (req: Request, res: Response) => {
  const vc = String(req.query.vc ?? '');
  const exp = Number(req.query.exp ?? 0);
  const sig = String(req.query.sig ?? '');
  const expected = sign(`apk.${vc}.${exp}`);
  const valid =
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
    exp > Date.now();
  if (!valid) {
    return res.status(403).json({ success: false, error: { message: 'Invalid download token' } });
  }
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ success: false, error: { message: 'APK not found' } });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="claude-webui.apk"');
  fs.createReadStream(APK_PATH).pipe(res);
});

export default router;
