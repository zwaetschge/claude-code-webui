import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import os from 'os';

/**
 * Generate a deterministic device fingerprint.
 * Uses /etc/machine-id (Fedora/systemd) + hardware characteristics.
 * Stable across reboots, unique per machine.
 */
export function generateFingerprint(): string {
  const components: string[] = [];

  // Primary: /etc/machine-id (systemd, persistent across reboots)
  try {
    const machineId = readFileSync('/etc/machine-id', 'utf-8').trim();
    components.push(machineId);
  } catch {
    // Fallback for non-systemd systems
    components.push('no-machine-id');
  }

  // Secondary hardware characteristics
  components.push(os.hostname());
  components.push(os.platform());
  components.push(os.arch());

  const cpus = os.cpus();
  if (cpus.length > 0) {
    components.push(cpus[0].model);
  }

  components.push(String(os.totalmem()));

  const raw = components.join('|');
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Get a human-readable device name for registration.
 */
export function getDeviceName(): string {
  const hostname = os.hostname();
  const platform = os.platform();
  const desktopEnv = process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '';

  if (desktopEnv) {
    return `${hostname} (${platform}/${desktopEnv})`;
  }
  return `${hostname} (${platform})`;
}
