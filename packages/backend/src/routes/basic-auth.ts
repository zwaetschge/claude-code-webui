import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { getAppConfig, setAppConfig } from '../db';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generateUserToken } from '../utils/authTokens';
import { upsertSharedCliUser } from '../utils/cliUser';

const router = Router();

// Login schema
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Change credentials schema
const changeCredentialsSchema = z.object({
  currentPassword: z.string().min(1),
  newUsername: z.string().min(3).optional(),
  newPassword: z.string().min(6).optional(),
});

// Check if basic auth is enabled
router.get('/status', (_req, res) => {
  const enabled = getAppConfig('basic_auth_enabled');
  res.json({
    success: true,
    data: {
      enabled: enabled === 'true',
    },
  });
});

// Login with username/password
router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { username, password } = parsed.data;

  // Check if basic auth is enabled
  const enabled = getAppConfig('basic_auth_enabled');
  if (enabled !== 'true') {
    throw new AppError('Basic authentication is disabled', 403, 'AUTH_DISABLED');
  }

  // Get stored credentials
  const storedUsername = getAppConfig('basic_auth_username');
  const storedPasswordHash = getAppConfig('basic_auth_password');

  if (!storedUsername || !storedPasswordHash) {
    throw new AppError('Basic auth not configured', 500, 'AUTH_NOT_CONFIGURED');
  }

  // Verify credentials
  if (username !== storedUsername) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const passwordValid = bcrypt.compareSync(password, storedPasswordHash);
  if (!passwordValid) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const displayName = storedUsername || 'admin';
  const email = `${displayName}@local`;
  const user = upsertSharedCliUser(email, displayName);
  const token = generateUserToken(user.id, { basicAuth: true, expiresIn: '30d' });

  res.json({
    success: true,
    data: {
      token,
      message: 'Login successful',
    },
  });
});

// Verify basic auth token
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.json({ success: true, data: { valid: false } });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { basicAuth?: boolean };
    if (decoded.basicAuth) {
      return res.json({ success: true, data: { valid: true } });
    }
  } catch {
    // Token invalid or expired
  }

  res.json({ success: true, data: { valid: false } });
});

// Logout (just returns success, client should clear token)
router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

// Get current credentials info (not the actual password)
router.get('/credentials', requireAuth, (_req, res) => {
  const username = getAppConfig('basic_auth_username');
  const enabled = getAppConfig('basic_auth_enabled');

  res.json({
    success: true,
    data: {
      username: username || 'admin',
      enabled: enabled === 'true',
    },
  });
});

// Change credentials (requires current password)
router.put('/credentials', requireAuth, (req, res) => {
  const parsed = changeCredentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { currentPassword, newUsername, newPassword } = parsed.data;

  // Verify current password
  const storedPasswordHash = getAppConfig('basic_auth_password');
  if (!storedPasswordHash) {
    throw new AppError('Basic auth not configured', 500, 'AUTH_NOT_CONFIGURED');
  }

  const passwordValid = bcrypt.compareSync(currentPassword, storedPasswordHash);
  if (!passwordValid) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
  }

  // Update username if provided
  if (newUsername) {
    setAppConfig('basic_auth_username', newUsername);
  }

  // Update password if provided
  if (newPassword) {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    setAppConfig('basic_auth_password', hashedPassword);
  }

  const updatedUsername = getAppConfig('basic_auth_username');

  res.json({
    success: true,
    data: {
      username: updatedUsername,
      message: 'Credentials updated successfully',
    },
  });
});

// Toggle basic auth enabled/disabled
router.put('/toggle', requireAuth, (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new AppError('Invalid input: enabled must be a boolean', 400, 'VALIDATION_ERROR');
  }

  setAppConfig('basic_auth_enabled', enabled ? 'true' : 'false');

  res.json({
    success: true,
    data: {
      enabled,
      message: enabled ? 'Basic auth enabled' : 'Basic auth disabled',
    },
  });
});

export default router;
