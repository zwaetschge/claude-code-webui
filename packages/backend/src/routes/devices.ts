import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDatabase } from '../db';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generateUserToken } from '../utils/authTokens';

const router = Router();

const registerSchema = z.object({
  deviceName: z.string().min(1).max(100),
  fingerprintHash: z.string().min(16).max(128),
  platform: z.string().max(50).optional(),
});

const authSchema = z.object({
  fingerprintHash: z.string().min(16).max(128),
});

// Register a new trusted device (requires existing auth)
router.post('/register', requireAuth, (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { deviceName, fingerprintHash, platform } = parsed.data;
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  // Check if fingerprint already registered
  const existing = db
    .prepare('SELECT id FROM trusted_devices WHERE fingerprint_hash = ?')
    .get(fingerprintHash) as { id: string } | undefined;

  if (existing) {
    // Update existing device
    db.prepare(
      'UPDATE trusted_devices SET device_name = ?, platform = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(deviceName, platform || null, existing.id);

    const deviceToken = generateUserToken(userId, { basicAuth: true, expiresIn: '90d' });

    res.json({
      success: true,
      data: { deviceToken, deviceId: existing.id },
    });
    return;
  }

  const deviceId = nanoid();
  db.prepare(
    `INSERT INTO trusted_devices (id, user_id, device_name, fingerprint_hash, platform, last_seen_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(deviceId, userId, deviceName, fingerprintHash, platform || null);

  const deviceToken = generateUserToken(userId, { basicAuth: true, expiresIn: '90d' });

  res.json({
    success: true,
    data: { deviceToken, deviceId },
  });
});

// Authenticate via device fingerprint (no auth required)
router.post('/auth', (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { fingerprintHash } = parsed.data;
  const db = getDatabase();

  const device = db
    .prepare(
      `SELECT td.id, td.user_id, td.device_name, u.name as user_name
     FROM trusted_devices td
     JOIN users u ON td.user_id = u.id
     WHERE td.fingerprint_hash = ?`
    )
    .get(fingerprintHash) as
    | { id: string; user_id: string; device_name: string; user_name: string }
    | undefined;

  if (!device) {
    throw new AppError('Unknown device', 401, 'DEVICE_NOT_FOUND');
  }

  // Update last seen
  db.prepare('UPDATE trusted_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    device.id
  );

  const token = generateUserToken(device.user_id, { basicAuth: true, expiresIn: '90d' });

  res.json({
    success: true,
    data: {
      token,
      userId: device.user_id,
      deviceName: device.device_name,
      userName: device.user_name,
    },
  });
});

// List all trusted devices for the current user
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const devices = db
    .prepare(
      'SELECT id, device_name, platform, last_seen_at, created_at FROM trusted_devices WHERE user_id = ? ORDER BY last_seen_at DESC'
    )
    .all(userId);

  res.json({
    success: true,
    data: { devices },
  });
});

// Remove a trusted device
router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const deviceId = req.params.id;
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?')
    .run(deviceId, userId);

  if (result.changes === 0) {
    throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }

  res.json({
    success: true,
    data: { message: 'Device removed' },
  });
});

export default router;
