import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initDatabase } from './db';
import { setupPassport } from './auth/passport';
import { setupWebSocket } from './websocket';
import { errorHandler, requestIdMiddleware } from './middleware/errorHandler';
import {
  previewVhostMiddleware,
  handlePreviewUpgrade,
  previewVhostEnabled,
} from './middleware/preview-vhost';
import { ensureCliPath } from './utils/cliPaths';
import { ensureDefaultClaudeMcpServers } from './utils/mcpDefaults';
import { syncProviderLinks } from './utils/providerLinks';
import type { CLIProvider } from '@plum-code-webui/shared';
import { CLI_UPDATE_PROVIDERS, runCliUpdates } from './services/cli-updates.js';

// Routes
import authRoutes from './routes/auth';
import basicAuthRoutes from './routes/basic-auth';
import sessionRoutes from './routes/sessions';
import filesRoutes from './routes/files';
import gitRoutes from './routes/git';
import settingsRoutes from './routes/settings';
import mcpRoutes from './routes/mcp';
import claudeRoutes from './routes/claude';
import claudeConfigRoutes from './routes/claude-config';
import claudeSettingsRoutes from './routes/claude-settings';
import permissionsRoutes from './routes/permissions';
import usageRoutes from './routes/usage';
import cliToolsRoutes from './routes/cli-tools';
import projectsRoutes from './routes/projects';
import githubRoutes from './routes/github';
import commandsRoutes from './routes/commands';
import analyticsRoutes from './routes/analytics';
import checkpointsRoutes from './routes/checkpoints';
import agentsRoutes from './routes/agents';
import notesRoutes from './routes/notes';
import categoriesRoutes from './routes/categories';
import providersRoutes from './routes/providers';
import providerOAuthRoutes from './routes/provider-oauth';
import cliProvidersRoutes from './routes/cli-providers';
import cliLoginRoutes from './routes/cli-login';
import codexRoutes from './routes/codex';
import opencodeRoutes from './routes/opencode';
import memoriesRoutes from './routes/memories';
import taskRoutes from './routes/tasks';
import devicesRoutes from './routes/devices';
import androidRoutes from './routes/android';
import previewRoutes from './routes/preview';
import adminRoutes from './routes/admin';
import comfyuiRoutes from './routes/comfyui';
import automationRoutes from './routes/automation';
import oracleRoutes from './routes/oracle';
import { initTaskManager } from './services/tasks';

function parseBooleanEnv(value?: string): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseCliUpdateProviders(value?: string): CLIProvider[] | undefined {
  if (!value) return undefined;
  const allowed = new Set(CLI_UPDATE_PROVIDERS);
  const providers = value
    .split(',')
    .map((provider) => provider.trim())
    .filter((provider): provider is CLIProvider => allowed.has(provider as CLIProvider));
  return providers.length > 0 ? providers : undefined;
}

function logUpdateSummary(results: { provider: CLIProvider; status: string }[]): void {
  if (!results.length) {
    console.log('[CLI UPDATE] No results returned.');
    return;
  }
  const summary = results.map((result) => `${result.provider}:${result.status}`).join(', ');
  console.log(`[CLI UPDATE] ${summary}`);
}

function installProcessGuards(): void {
  // Global guards: without these, a stray unhandled rejection from any long-running service
  // (ClaudeProcessManager, task runners, etc.) crashes the server silently.
  process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error(
      '[CRITICAL] Unhandled Rejection at:',
      promise,
      'reason:',
      err.stack || err.message
    );
  });

  process.on('uncaughtException', (err, origin) => {
    console.error(`[CRITICAL] Uncaught Exception (${origin}):`, err.stack || err.message);
    // After an uncaught exception the process may be in an undefined state — exit so a supervisor restarts us.
    process.exit(1);
  });
}

/**
 * Register graceful shutdown hooks. Closes the HTTP server first (so inbound
 * traffic stops), then kills all Claude child processes, then forces exit.
 * A hard timeout prevents a wedged process from lingering forever.
 */
function registerGracefulShutdown(
  httpServer: import('http').Server,
  io: import('socket.io').Server
): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] Received ${signal}, draining.`);

    const forceExit = setTimeout(() => {
      console.error('[SHUTDOWN] Grace period elapsed, forcing exit.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      // Stop accepting new HTTP connections / upgrades.
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      // Disconnect all WebSocket clients so they reconnect to the new instance.
      io.disconnectSockets(true);
      // Dynamically import to avoid circular load if shutdown fires before setup.
      const { getProcessManager } = await import('./websocket');
      try {
        await getProcessManager().shutdownAll();
      } catch (err) {
        console.warn('[SHUTDOWN] processManager shutdown skipped:', err);
      }
    } catch (err) {
      console.error('[SHUTDOWN] Drain error:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main() {
  installProcessGuards();

  // Initialize database
  initDatabase();
  ensureCliPath();
  try {
    const mcpDefaults = await ensureDefaultClaudeMcpServers();
    if (mcpDefaults.updated) {
      console.log(
        `[mcp-defaults] Added ${mcpDefaults.added.join(', ')} to ${mcpDefaults.settingsPath}`
      );
    }
  } catch (err) {
    console.warn('[mcp-defaults] sync skipped:', err);
  }
  syncProviderLinks();

  const app = express();

  // Trust proxy headers when behind nginx/reverse proxy. `true` is dangerous
  // without a guard proxy — any client can spoof X-Forwarded-For and defeat
  // IP-based rate limiting. Configure via TRUST_PROXY (default: 1 hop).
  app.set('trust proxy', config.trustProxy);

  const httpServer = createServer(app);

  // Setup WebSocket
  const io = setupWebSocket(httpServer);

  // Initialize task delegation system
  initTaskManager();

  // Preview vhost — must run BEFORE any other middleware so helmet/CORS/body-parsers
  // don't rewrite or consume proxied traffic. Authelia (Traefik ForwardAuth) guards the
  // subdomain at the edge, so only authenticated users reach this handler.
  if (previewVhostEnabled()) {
    app.use(previewVhostMiddleware);
    httpServer.on('upgrade', (req, socket, head) => {
      handlePreviewUpgrade(req, socket as import('net').Socket, head);
    });
    console.log(`[PREVIEW] Proxy vhost enabled for ${config.previewHostname}`);
  }

  // Middleware
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      // The Vite build emits no inline scripts, so `script-src 'self'` is a strict
      // policy without needing per-request nonce injection. Style injection from
      // Radix UI and the inline <style> block in index.html requires
      // 'unsafe-inline' on style-src — style-based attacks have a much smaller
      // blast radius than script-based ones, so this tradeoff is acceptable.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          // Socket.IO upgrades same-origin XHR to WebSocket. Browsers differ on
          // whether 'self' implicitly covers ws:/wss:, so we list both explicitly.
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    })
  );
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const isTrustedOrigin =
      req.secure || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isTrustedOrigin) {
      res.removeHeader('Cross-Origin-Opener-Policy');
      res.removeHeader('Origin-Agent-Cluster');
    }
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests (no origin header)
        if (!origin) {
          return callback(null, true);
        }
        // Check if origin is in the allowed list
        const normalizedOrigin = origin.toLowerCase();
        if (config.allowedOrigins.includes(normalizedOrigin)) {
          return callback(null, true);
        }
        // Reject unauthorized origins
        console.warn(`CORS: Rejected request from unauthorized origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.isProduction,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  // Passport
  setupPassport();
  app.use(passport.initialize());
  app.use(passport.session());

  // Make io available in routes
  app.set('io', io);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api/basic-auth', basicAuthRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/git', gitRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/oracle', oracleRoutes);
  app.use('/api/mcp-servers', mcpRoutes);
  app.use('/api/claude', claudeRoutes);
  app.use('/api/claude-config', claudeConfigRoutes);
  app.use('/api/claude-settings', claudeSettingsRoutes);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/cli-tools', cliToolsRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/api/commands', commandsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/checkpoints', checkpointsRoutes);
  app.use('/api/agents', agentsRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/providers', providersRoutes);
  app.use('/api/providers', providerOAuthRoutes);
  app.use('/api/cli-providers', cliProvidersRoutes);
  app.use('/api/cli-login', cliLoginRoutes);
  app.use('/api/codex', codexRoutes);
  app.use('/api/opencode', opencodeRoutes);
  app.use('/api/memories', memoriesRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/devices', devicesRoutes);
  app.use('/api/android', androidRoutes);
  app.use('/api/preview', previewRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/comfyui', comfyuiRoutes);
  app.use('/api/automation', automationRoutes);

  const logosDir = process.env.LOGOS_DIR || path.join(process.cwd(), 'logos');
  if (fs.existsSync(logosDir)) {
    app.use('/logos', express.static(logosDir));
  }

  // Generated images from the ComfyUI MCP tool. Session-cookie-gated so <img>
  // tags in chat bubbles work (Authorization headers aren't sent with images).
  // Filenames are UUIDs, but we still require a session to avoid leaking generated
  // content to unauthenticated users on the same origin.
  const generatedDir =
    process.env.COMFYUI_OUTPUT_DIR || path.join(process.cwd(), 'packages/backend/data/generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }
  app.use(
    '/generated',
    (req, res, next) => {
      if (req.isAuthenticated && req.isAuthenticated()) return next();
      res.status(401).send('unauthorized');
    },
    express.static(generatedDir, {
      fallthrough: false,
      maxAge: '1h',
      index: false,
      dotfiles: 'deny',
    })
  );

  // Serve frontend static files in production
  if (config.isProduction) {
    const frontendPath = path.join(__dirname, '../../frontend/dist');
    const designPreviewPath = path.join(frontendPath, 'design-previews');
    app.use(
      '/design-previews',
      (_req, res, next) => {
        res.setHeader(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'none'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'self'",
          ].join('; ')
        );
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        next();
      },
      express.static(designPreviewPath, {
        fallthrough: false,
        index: false,
        maxAge: 0,
        dotfiles: 'deny',
      })
    );

    app.use(express.static(frontendPath));

    // Backend auth routes that should NOT be handled by SPA
    const backendAuthRoutes = [
      '/auth/github',
      '/auth/google',
      '/auth/claude',
      '/auth/codex',
      '/auth/dev',
      '/auth/dev-login',
      '/auth/me',
      '/auth/logout',
      '/auth/providers',
    ];

    const staticAssetPrefixes = [
      '/assets/',
      '/claude-logo.png',
      '/favicon.svg',
      '/design-previews/',
      '/manifest.json',
      '/sw.js',
      '/service-worker.js',
    ];

    // Handle SPA routing - serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      // Skip API routes and backend auth routes
      if (
        req.path.startsWith('/api') ||
        backendAuthRoutes.some((r) => req.path.startsWith(r)) ||
        staticAssetPrefixes.some((prefix) => req.path.startsWith(prefix))
      ) {
        return next();
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  // Error handler
  app.use(errorHandler);

  // Start server
  httpServer.listen(config.port, config.host, () => {
    console.log(`Server running on http://${config.host}:${config.port}`);
    console.log(`Frontend URL: ${config.frontendUrl}`);
  });

  registerGracefulShutdown(httpServer, io);

  // Bootstrap Codex CLI config — generates ~/.codex/config.toml with WebUI defaults
  // and mirrors MCP servers from ~/.claude/settings.json so Codex sessions get the
  // same tool surface. Idempotent; runs once per boot. Best-effort, errors logged.
  void import('./utils/codexConfigSync')
    .then(({ syncCodexConfig }) => syncCodexConfig())
    .then((status) => console.log(`[codex-config] ${status}`))
    .catch((err) => console.warn('[codex-config] sync skipped:', err));

  const autoUpdateEnabled = parseBooleanEnv(process.env.CLI_AUTO_UPDATE);
  const intervalHours = Number(process.env.CLI_AUTO_UPDATE_INTERVAL_HOURS || 0);
  const providers = parseCliUpdateProviders(process.env.CLI_AUTO_UPDATE_PROVIDERS);

  if (autoUpdateEnabled) {
    const runUpdate = () => {
      runCliUpdates(providers)
        .then((data) => logUpdateSummary(data.results))
        .catch((error) => console.error('[CLI UPDATE] Failed:', error));
    };

    runUpdate();

    if (Number.isFinite(intervalHours) && intervalHours > 0) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      setInterval(runUpdate, intervalMs);
      console.log(`[CLI UPDATE] Scheduled every ${intervalHours} hour(s).`);
    }
  }
}

main().catch(console.error);
