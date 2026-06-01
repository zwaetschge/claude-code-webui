import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDatabase } from '../db';
import { AppError } from './errorHandler';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

function getUserRoleStatus(userId: string): { role: string; status: string } | null {
  try {
    const db = getDatabase();
    const row = db.prepare(`SELECT role, status FROM users WHERE id = ?`).get(userId) as
      | { role: string; status: string }
      | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Block suspended users from any authenticated endpoint. Must run AFTER requireAuth.
 * Splitting this out (instead of merging into requireAuth) keeps the fast path hot
 * while making the guard explicit at the route level.
 */
export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const info = getUserRoleStatus(userId);
  if (!info) throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  next();
}

/**
 * Gate admin-only routes. Runs requireActive implicitly (suspended admins can't log in).
 * Use after requireAuth. 403 (not 404) so admins know the route exists.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const info = getUserRoleStatus(userId);
  if (!info) throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  if (info.role !== 'admin') {
    throw new AppError('Admin privileges required', 403, 'ADMIN_REQUIRED');
  }
  next();
}

/**
 * Verify the token's user still exists and is not suspended.
 * Prevents long-lived JWTs from outliving user deletion/suspension.
 * A single indexed lookup (~0.1ms) on every authenticated request.
 */
function enforceUserLifecycle(userId: string): void {
  const info = getUserRoleStatus(userId);
  if (!info) {
    throw new AppError('User no longer exists', 401, 'USER_NOT_FOUND');
  }
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Check for JWT in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    let userId: string;
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      userId = decoded.userId;
    } catch {
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
    }
    enforceUserLifecycle(userId);
    (req as AuthenticatedRequest).userId = userId;
    return next();
  }

  // Check for session-based auth
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const userId = (req.user as { id: string }).id;
    enforceUserLifecycle(userId);
    (req as AuthenticatedRequest).userId = userId;
    return next();
  }

  throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      (req as AuthenticatedRequest).userId = decoded.userId;
    } catch {
      // Ignore invalid tokens for optional auth
    }
  } else if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    (req as AuthenticatedRequest).userId = (req.user as { id: string }).id;
  }
  next();
}
