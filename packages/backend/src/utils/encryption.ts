import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get or derive a 32-byte encryption key from the config
 */
function getKey(): Buffer {
  const key = config.encryptionKey;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // If key is already 32 bytes hex (64 chars), use it directly
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }

  // Otherwise, derive a key using PBKDF2
  return crypto.pbkdf2Sync(key, 'claude-code-webui-salt', 100000, 32, 'sha256');
}

/**
 * Encrypt a plaintext string
 * @returns Base64-encoded ciphertext with IV and auth tag prepended
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a Base64-encoded ciphertext
 * @returns Decrypted plaintext string
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const combined = Buffer.from(ciphertext, 'base64');

  // Extract IV, authTag, and encrypted data
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Check if encryption is available (ENCRYPTION_KEY is set)
 */
export function isEncryptionAvailable(): boolean {
  return !!config.encryptionKey;
}

/**
 * Safely encrypt a value, returning null if encryption is not available
 */
export function safeEncrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (!isEncryptionAvailable()) {
    console.warn('ENCRYPTION_KEY not set - storing API key without encryption');
    return plaintext;
  }
  return encrypt(plaintext);
}

/**
 * Safely decrypt a value, handling both encrypted and plaintext values
 */
export function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!isEncryptionAvailable()) {
    return ciphertext;
  }

  try {
    return decrypt(ciphertext);
  } catch {
    // Value might not be encrypted (legacy data)
    return ciphertext;
  }
}
