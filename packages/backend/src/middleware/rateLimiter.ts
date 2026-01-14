import type { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Max requests per window
  message?: string;       // Error message
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limits (can be replaced with Redis for multi-instance)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Cleanup every minute

/**
 * Get client identifier for rate limiting
 */
function getClientId(req: Request): string {
  // Use user ID if authenticated, otherwise use IP
  const userId = (req as unknown as { userId?: string }).userId;
  if (userId) {
    return `user:${userId}`;
  }

  // Get IP address (handle proxies)
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0]?.trim()
    : req.ip || req.socket.remoteAddress || 'unknown';

  return `ip:${ip}`;
}

/**
 * Create a rate limiter middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, message = 'Too many requests, please try again later' } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = getClientId(req);
    const key = `${clientId}:${req.path}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter,
        },
      });
    }

    next();
  };
}

// Pre-configured rate limiters for common use cases
export const rateLimiters = {
  // Standard API rate limit: 100 requests per minute
  standard: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  // Strict rate limit for sensitive operations: 10 per minute
  strict: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: 'Too many attempts, please wait before trying again',
  }),

  // File upload limit: 20 uploads per minute
  upload: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many file uploads, please wait before uploading more',
  }),

  // Session creation: 5 per minute
  sessionCreation: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: 'Too many sessions created, please wait before creating more',
  }),

  // Message sending: 30 per minute (per session)
  messaging: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Sending messages too quickly, please slow down',
  }),

  // Image generation: 5 per minute
  imageGeneration: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: 'Too many image generation requests, please wait',
  }),
};

export default rateLimiters;
