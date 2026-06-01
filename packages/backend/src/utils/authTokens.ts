import jwt from 'jsonwebtoken';
import { config } from '../config';

type TokenOptions = {
  basicAuth?: boolean;
  expiresIn?: string | number;
};

export function generateUserToken(userId: string, options: TokenOptions = {}): string {
  const payload = {
    userId,
    basicAuth: options.basicAuth || false,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: options.expiresIn || '7d',
  } as jwt.SignOptions);
}
