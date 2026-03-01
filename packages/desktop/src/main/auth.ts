import { net } from 'electron';
import { generateFingerprint, getDeviceName } from './fingerprint';
import { loadDeviceConfig, saveDeviceConfig } from './store';

interface AuthResult {
  success: boolean;
  token?: string;
  serverUrl?: string;
  error?: string;
}

interface DeviceAuthResponse {
  success: boolean;
  data?: {
    token: string;
    userId: string;
    deviceName: string;
    userName: string;
  };
}

interface DeviceRegisterResponse {
  success: boolean;
  data?: {
    deviceToken: string;
    deviceId: string;
  };
}

interface BasicAuthLoginResponse {
  success: boolean;
  data?: {
    token: string;
  };
}

/**
 * Try to authenticate using stored device token + fingerprint.
 * Returns a fresh JWT if the device is trusted.
 */
export async function tryDeviceAuth(): Promise<AuthResult> {
  const config = loadDeviceConfig();
  if (!config) {
    return { success: false, error: 'No stored config' };
  }

  const fingerprint = generateFingerprint();

  try {
    const response = await netFetch(`${config.serverUrl}/api/devices/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprintHash: fingerprint }),
    });

    const data = (await response.json()) as DeviceAuthResponse;

    if (data.success && data.data?.token) {
      return {
        success: true,
        token: data.data.token,
        serverUrl: config.serverUrl,
      };
    }

    return { success: false, error: 'Device not recognized' };
  } catch (err) {
    return { success: false, error: `Connection failed: ${err}` };
  }
}

/**
 * Register this device with the server after basic auth login.
 * 1. Login with username/password → get temp JWT
 * 2. Register device with fingerprint → get long-lived device token
 */
export async function registerDevice(
  serverUrl: string,
  username: string,
  password: string,
): Promise<AuthResult> {
  // Step 1: Basic auth login
  let loginToken: string;
  try {
    const loginRes = await netFetch(`${serverUrl}/api/basic-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const loginData = (await loginRes.json()) as BasicAuthLoginResponse;
    if (!loginData.success || !loginData.data?.token) {
      return { success: false, error: 'Invalid credentials' };
    }
    loginToken = loginData.data.token;
  } catch (err) {
    return { success: false, error: `Login failed: ${err}` };
  }

  // Step 2: Register device
  const fingerprint = generateFingerprint();
  const deviceName = getDeviceName();

  try {
    const regRes = await netFetch(`${serverUrl}/api/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginToken}`,
      },
      body: JSON.stringify({
        deviceName,
        fingerprintHash: fingerprint,
        platform: process.platform,
      }),
    });

    const regData = (await regRes.json()) as DeviceRegisterResponse;
    if (!regData.success || !regData.data) {
      return { success: false, error: 'Device registration failed' };
    }

    // Save to encrypted store
    saveDeviceConfig({
      serverUrl,
      deviceToken: regData.data.deviceToken,
      deviceId: regData.data.deviceId,
    });

    return {
      success: true,
      token: regData.data.deviceToken,
      serverUrl,
    };
  } catch (err) {
    return { success: false, error: `Registration failed: ${err}` };
  }
}

/**
 * Wrapper around Electron's net.fetch for making HTTP requests
 * from the main process (respects system proxy settings).
 */
function netFetch(url: string, options: RequestInit): Promise<Response> {
  return net.fetch(url, options);
}
