import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

interface StoreData {
  serverUrl: string;
  deviceToken: string;
  deviceId: string;
}

const STORE_FILE = 'device-config.enc';

function getStorePath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, STORE_FILE);
}

/**
 * Save device configuration encrypted with OS keyring (KWallet on KDE).
 */
export function saveDeviceConfig(data: StoreData): void {
  const json = JSON.stringify(data);

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    const dir = app.getPath('userData');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getStorePath(), encrypted);
  } else {
    // Fallback: store as plain JSON (not ideal but functional)
    const dir = app.getPath('userData');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getStorePath(), json, 'utf-8');
  }
}

/**
 * Load device configuration from encrypted store.
 */
export function loadDeviceConfig(): StoreData | null {
  const storePath = getStorePath();
  if (!existsSync(storePath)) {
    return null;
  }

  try {
    const raw = readFileSync(storePath);

    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted) as StoreData;
    } else {
      return JSON.parse(raw.toString('utf-8')) as StoreData;
    }
  } catch {
    return null;
  }
}

/**
 * Clear stored device configuration.
 */
export function clearDeviceConfig(): void {
  const storePath = getStorePath();
  if (existsSync(storePath)) {
    unlinkSync(storePath);
  }
}
