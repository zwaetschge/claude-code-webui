import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { NextFunction, Request, Response } from 'express';
import { createReadStream, type Stats } from 'fs';
import fs from 'fs/promises';
import httpProxy from 'http-proxy';
import { config } from '../config.js';
import {
  STATIC_INIT_PATH,
  STATIC_ROOT_COOKIE,
  decodePreviewRoot,
  previewContentType,
  resolvePreviewStaticPath,
} from '../utils/previewStatic.js';

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

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match || !match[1]) return null;
  return match[1];
}

function parsePortCookie(cookieHeader: string | undefined): number | null {
  const raw = parseCookie(cookieHeader, PORT_COOKIE);
  if (!raw) return null;
  const port = parseInt(raw, 10);
  return isPortAllowed(port) ? port : null;
}

function parseStaticRootCookie(cookieHeader: string | undefined): string | null {
  const token = parseCookie(cookieHeader, STATIC_ROOT_COOKIE);
  return token ? decodePreviewRoot(token) : null;
}

function errorPage(title: string, detail: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c] || c;
    });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:2rem;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:520px;padding:2rem;border:1px solid #262626;border-radius:12px;background:#111}
h1{margin:0 0 .5rem;font-size:1.25rem;color:#fafafa}p{margin:.25rem 0;color:#a3a3a3;font-size:.875rem}
code{font-family:ui-monospace,monospace;background:#1a1a1a;padding:.125rem .375rem;border-radius:4px;color:#d4d4d4}</style>
</head><body><div class="card"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p>Pick a port or HTML file from the WebUI preview panel to start.</p></div></body></html>`;
}

function normalizePreviewPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function cookieString(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    config.isProduction ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

function clearCookieString(name: string): string {
  return cookieString(name, '', 0);
}

function initSetupPage(port: number, previewPath: string): string {
  const destination = JSON.stringify(previewPath).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Preview ready</title></head><body><script>location.replace(${destination});</script>Setting up preview for port ${port}...</body></html>`;
}

function staticSetupPage(previewPath: string): string {
  const destination = JSON.stringify(previewPath).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Static preview ready</title></head><body><script>location.replace(${destination});</script>Opening static preview...</body></html>`;
}

// Sets the preview_port cookie. Called via iframe src change when user picks a port.
function handleInit(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const portParam = url.searchParams.get('port');
  const port = portParam ? parseInt(portParam, 10) : NaN;
  const previewPath = normalizePreviewPath(url.searchParams.get('to'));

  if (!isPortAllowed(port)) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      errorPage(
        'Invalid port',
        `Port must be an integer between 1024 and 65535, not equal to ${config.port}.`
      )
    );
    return;
  }

  // HttpOnly signed by nothing — we rely on Authelia (Traefik ForwardAuth) for AuthZ.
  // Cookies are scoped to the preview subdomain only.
  const cookies = [
    cookieString(PORT_COOKIE, String(port), 60 * 60 * 8),
    clearCookieString(STATIC_ROOT_COOKIE),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookies,
  });
  res.end(initSetupPage(port, previewPath));
}

function handleStaticInit(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const token = url.searchParams.get('root') || '';
  const rootPath = decodePreviewRoot(token);
  const fileParam = url.searchParams.get('file') || 'index.html';
  const previewPath = normalizePreviewPath(`/${fileParam}`);

  if (!rootPath) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Invalid static preview', 'The preview root token is invalid.'));
    return;
  }

  const resolvedPath = resolvePreviewStaticPath(rootPath, previewPath);
  if (!resolvedPath) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Static preview blocked', 'The requested file is not previewable.'));
    return;
  }

  const cookies = [
    cookieString(STATIC_ROOT_COOKIE, token, 60 * 60 * 8),
    clearCookieString(PORT_COOKIE),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookies,
  });
  res.end(staticSetupPage(previewPath));
}

function handleClear(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': [clearCookieString(PORT_COOKIE), clearCookieString(STATIC_ROOT_COOKIE)],
  });
  res.end(errorPage('Preview cleared', 'Pick a port from the WebUI to reconnect.'));
}

async function serveStaticPreview(req: Request, res: Response, rootPath: string): Promise<void> {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const filePath = resolvePreviewStaticPath(rootPath, pathname);
  if (!filePath) {
    res
      .status(403)
      .type('html')
      .send(errorPage('Static preview blocked', 'The requested file is not previewable.'));
    return;
  }

  const contentType = previewContentType(filePath);
  if (!contentType) {
    res
      .status(403)
      .type('html')
      .send(errorPage('Static preview blocked', 'This file type is not previewable.'));
    return;
  }

  let stats: Stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    res.status(404).type('html').send(errorPage('Static file not found', pathname));
    return;
  }

  if (!stats.isFile()) {
    res.status(404).type('html').send(errorPage('Static file not found', pathname));
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(filePath).pipe(res);
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

  if (reqUrl === STATIC_INIT_PATH || reqUrl.startsWith(`${STATIC_INIT_PATH}?`)) {
    handleStaticInit(req, res);
    return;
  }

  if (reqUrl === '/__preview-clear') {
    handleClear(req, res);
    return;
  }

  const staticRoot = parseStaticRootCookie(req.headers.cookie);
  if (staticRoot) {
    void serveStaticPreview(req, res, staticRoot).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Static preview failed';
      if (!res.headersSent) {
        res.status(500).type('html').send(errorPage('Static preview failed', message));
      } else {
        res.end();
      }
    });
    return;
  }

  const port = parsePortCookie(req.headers.cookie);
  if (!port) {
    res
      .status(412)
      .type('html')
      .send(
        errorPage('No preview target selected', 'The preview session cookie is missing or invalid.')
      );
    return;
  }

  proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
  const host = ((req.headers.host || '').split(':')[0] || '').toLowerCase();
  if (!isPreviewHost(host)) {
    return false;
  }

  if (parseStaticRootCookie(req.headers.cookie)) {
    socket.destroy();
    return true;
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
