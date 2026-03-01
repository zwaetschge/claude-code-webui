import { BrowserWindow, shell } from 'electron';
import path from 'path';

let setupWindow: BrowserWindow | null = null;
let appWindow: BrowserWindow | null = null;

/**
 * Create the first-run setup window.
 * Shows a local HTML form for server URL + credentials.
 */
export function createSetupWindow(): BrowserWindow {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 480,
    height: 580,
    resizable: false,
    title: 'Claude Code WebUI — Setup',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load local setup HTML
  const setupHtml = getSetupHTML();
  setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHtml)}`);

  setupWindow.on('closed', () => {
    setupWindow = null;
  });

  return setupWindow;
}

/**
 * Create the main app window that loads the remote WebUI.
 */
export function createAppWindow(serverUrl: string, token: string): BrowserWindow {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.focus();
    return appWindow;
  }

  appWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Claude Code WebUI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the WebUI with auth token injection
  const authUrl = `${serverUrl}/auth/callback?token=${encodeURIComponent(token)}`;
  appWindow.loadURL(authUrl);

  // Intercept external navigation — open in default browser
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverUrl)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept navigation to external URLs
  appWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  appWindow.on('closed', () => {
    appWindow = null;
  });

  return appWindow;
}

export function getSetupWindow(): BrowserWindow | null {
  return setupWindow;
}

export function getAppWindow(): BrowserWindow | null {
  return appWindow;
}

export function closeSetupWindow(): void {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
    setupWindow = null;
  }
}

function getSetupHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code WebUI — Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 380px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #a0a0a0;
      font-size: 0.875rem;
      text-align: center;
      margin-bottom: 32px;
    }
    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: #d4d4d4;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fafafa;
      font-size: 0.9375rem;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus {
      border-color: #3b82f6;
    }
    input::placeholder {
      color: #666;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }
    button:hover:not(:disabled) {
      background: #2563eb;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      background: #7f1d1d;
      border: 1px solid #991b1b;
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 16px;
      display: none;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Connect to Server</h1>
    <p class="subtitle">Enter your Claude Code WebUI server details</p>

    <div id="error" class="error"></div>

    <form id="setupForm">
      <label for="serverUrl">Server URL</label>
      <input type="url" id="serverUrl" placeholder="https://your-domain.example.com" required autofocus>

      <label for="username">Username</label>
      <input type="text" id="username" placeholder="admin" required>

      <label for="password">Password</label>
      <input type="password" id="password" placeholder="Password" required>

      <button type="submit" id="submitBtn">Connect & Register Device</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('setupForm');
    const errorEl = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>Connecting...';

      const serverUrl = document.getElementById('serverUrl').value.replace(/\\/+$/, '');
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const result = await window.electronAPI.registerDevice(serverUrl, username, password);
        if (!result.success) {
          throw new Error(result.error || 'Registration failed');
        }
        // Success — main process will open app window
      } catch (err) {
        errorEl.textContent = err.message || 'Connection failed';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect & Register Device';
      }
    });
  </script>
</body>
</html>`;
}
