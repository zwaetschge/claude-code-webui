import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { NextFunction, Request, Response } from 'express';
import httpProxy from 'http-proxy';
import { config } from '../config';

const PORT_COOKIE = 'preview_port';
const INIT_PATH = '/__preview-init';

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: false,
  secure: false,
  selfHandleResponse: false,
});

proxy.on('error', (err, _req, res) => {
  if (res && 'writeHead' in res && !res.headersSent) {
    try {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(errorPage('Dev server not reachable', err.message));
    } catch {
      // ignore
    }
  } else if (res && 'destroy' in res) {
    try {
      (res as unknown as Socket).destroy();
    } catch {
      // ignore
    }
  }
});

function isPreviewHost(host: string | undefined): boolean {
  if (!config.previewHostname || !host) return false;
  return host.toLowerCase() === config.previewHostname;
}

function isPortAllowed(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  if (port < 1024 || port > 65535) return false;
  // Never proxy to our own backend — would create loops / bypass auth
  if (port === config.port) return false;
  return true;
}

function parsePortCookie(cookieHeader: string | undefined): number | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PORT_COOKIE}=(\\d+)`));
  if (!match || !match[1]) return null;
  const port = parseInt(match[1], 10);
  return isPortAllowed(port) ? port : null;
}

function errorPage(title: string, detail: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] || c;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:2rem;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:520px;padding:2rem;border:1px solid #262626;border-radius:12px;background:#111}
h1{margin:0 0 .5rem;font-size:1.25rem;color:#fafafa}p{margin:.25rem 0;color:#a3a3a3;font-size:.875rem}
code{font-family:ui-monospace,monospace;background:#1a1a1a;padding:.125rem .375rem;border-radius:4px;color:#d4d4d4}</style>
</head><body><div class="card"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p>Pick a port from the WebUI preview panel to start.</p></div></body></html>`;
}

function initSetupPage(port: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>Preview ready</title></head><body><script>location.replace('/');</script>Setting up preview for port ${port}…</body></html>`;
}

// Sets the preview_port cookie. Called via iframe src change when user picks a port.
function handleInit(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const portParam = url.searchParams.get('port');
  const port = portParam ? parseInt(portParam, 10) : NaN;

  if (!isPortAllowed(port)) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Invalid port', `Port must be an integer between 1024 and 65535, not equal to ${config.port}.`));
    return;
  }

  // HttpOnly signed by nothing — we rely on Authelia (Traefik ForwardAuth) for AuthZ.
  // Cookie is scoped to the preview subdomain only.
  const cookie = [
    `${PORT_COOKIE}=${port}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    config.isProduction ? 'Secure' : '',
    `Max-Age=${60 * 60 * 8}`, // 8 hours
  ].filter(Boolean).join('; ');

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookie,
  });
  res.end(initSetupPage(port));
}

function handleClear(_req: IncomingMessage, res: ServerResponse): void {
  const cookie = [
    `${PORT_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    config.isProduction ? 'Secure' : '',
    'Max-Age=0',
  ].filter(Boolean).join('; ');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookie,
  });
  res.end(errorPage('Preview cleared', 'Pick a port from the WebUI to reconnect.'));
}

export function previewVhostMiddleware(req: Request, res: Response, next: NextFunction): void {
  const host = req.hostname?.toLowerCase();
  if (!isPreviewHost(host)) {
    next();
    return;
  }

  const reqUrl = req.url || '/';

  if (reqUrl === INIT_PATH || reqUrl.startsWith(`${INIT_PATH}?`)) {
    handleInit(req, res);
    return;
  }

  if (reqUrl === '/__preview-clear') {
    handleClear(req, res);
    return;
  }

  const port = parsePortCookie(req.headers.cookie);
  if (!port) {
    res.status(412)
      .type('html')
      .send(errorPage('No preview port selected', 'The preview session cookie is missing or invalid.'));
    return;
  }

  proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
  const host = ((req.headers.host || '').split(':')[0] || '').toLowerCase();
  if (!isPreviewHost(host)) {
    return false;
  }

  const port = parsePortCookie(req.headers.cookie);
  if (!port) {
    socket.destroy();
    return true;
  }

  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` });
  return true;
}

export function previewVhostEnabled(): boolean {
  return Boolean(config.previewHostname);
}
