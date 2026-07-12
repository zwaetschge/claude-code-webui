import type { CookieOptions } from 'express-session';

const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  };
}
