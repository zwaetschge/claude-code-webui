import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './errorHandler';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Check for JWT in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      (req as AuthenticatedRequest).userId = decoded.userId;
      return next();
    } catch {
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
    }
  }

  // Check for session-based auth
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    (req as AuthenticatedRequest).userId = (req.user as { id: string }).id;
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
