import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiError } from '@claude-code-webui/shared';

// Wrap async route handlers to properly catch errors
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  if (err instanceof AppError) {
    const errorResponse: ApiError = {
      code: err.code,
      message: err.message,
    };
    res.status(err.statusCode).json({ success: false, error: errorResponse });
    return;
  }

  const errorResponse: ApiError = {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  res.status(500).json({ success: false, error: errorResponse });
}
