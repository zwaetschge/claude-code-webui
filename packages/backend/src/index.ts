import express from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
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
import { errorHandler } from './middleware/errorHandler';
import { ensureCliPath } from './utils/cliPaths';
import type { CLIProvider } from '@claude-code-webui/shared';
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
import geminiRoutes from './routes/gemini';
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
import selfRebuildRoutes from './routes/self-rebuild';
import watchdogRoutes from './routes/watchdog';
import ralphRoutes from './routes/ralph';
import memoriesRoutes from './routes/memories';
import handoverRoutes from './routes/handover';
import taskRoutes from './routes/tasks';
import devicesRoutes from './routes/devices';
import { initSelfRebuild, setSocketIO } from './services/self-rebuild';
import { initWatchdog } from './services/watchdog/WatchdogService';
import { initRalph } from './services/ralph';
import { initTaskManager } from './services/tasks';
import { getProcessManager } from './websocket';

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
  const summary = results
    .map((result) => `${result.provider}:${result.status}`)
    .join(', ');
  console.log(`[CLI UPDATE] ${summary}`);
}

async function main() {
  // Initialize database
  initDatabase();
  ensureCliPath();

  const app = express();

  // Trust proxy headers when behind nginx/reverse proxy
  // This enables proper handling of X-Forwarded-Proto, X-Forwarded-Host, etc.
  app.set('trust proxy', true);

  const httpServer = createServer(app);

  // Setup WebSocket
  const io = setupWebSocket(httpServer);

  // Initialize self-rebuild service with Socket.IO for broadcasting
  setSocketIO(io);
  await initSelfRebuild();

  // Read handover file from previous container lifecycle
  const handoverFile = path.join(process.cwd(), 'data', 'container-handover.json');
  try {
    const handoverData = JSON.parse(await fsPromises.readFile(handoverFile, 'utf-8'));
    console.log(`[handover] ========================================`);
    console.log(`[handover] Container neugestartet durch: ${handoverData.from}`);
    console.log(`[handover] Grund: ${handoverData.reason || 'unbekannt'}`);
    console.log(`[handover] Unterbrochene Sessions: ${handoverData.activeSessions || 0}`);
    if (handoverData.message) {
      console.log(`[handover] Nachricht: ${handoverData.message}`);
    }
    console.log(`[handover] ========================================`);
    await fsPromises.unlink(handoverFile);
  } catch {
    // No handover file — normal startup
  }

  // Initialize watchdog service (with process manager for CLI integration)
  initWatchdog(io, getProcessManager());

  // Initialize Ralph autonomous loop service
  initRalph(io, getProcessManager());

  // Initialize task delegation system
  initTaskManager();

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }));
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const isTrustedOrigin = req.secure || host === 'localhost' || host === '127.0.0.1' || host === '::1';
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

  // Instance info (used by frontend to show repair-bot banner)
  app.get('/api/instance-info', (_req, res) => {
    res.json({
      repairBotMode: process.env.DISABLE_SELF_REBUILD === 'true',
    });
  });

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api/basic-auth', basicAuthRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/git', gitRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/mcp-servers', mcpRoutes);
  app.use('/api/claude', claudeRoutes);
  app.use('/api/claude-config', claudeConfigRoutes);
  app.use('/api/claude-settings', claudeSettingsRoutes);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/cli-tools', cliToolsRoutes);
  app.use('/api/gemini', geminiRoutes);
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
  app.use('/api/self-rebuild', selfRebuildRoutes);
  app.use('/api/watchdog', watchdogRoutes);
  app.use('/api/ralph', ralphRoutes);
  app.use('/api/memories', memoriesRoutes);
  app.use('/api/handover', handoverRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/devices', devicesRoutes);

  const logosDir = process.env.LOGOS_DIR || path.join(process.cwd(), 'logos');
  if (fs.existsSync(logosDir)) {
    app.use('/logos', express.static(logosDir));
  }

  // Serve frontend static files in production
  if (config.isProduction) {
    const frontendPath = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(frontendPath));

    // Backend auth routes that should NOT be handled by SPA
    const backendAuthRoutes = [
      '/auth/github', '/auth/google', '/auth/claude', '/auth/codex', '/auth/zai', '/auth/dev',
      '/auth/dev-login', '/auth/me', '/auth/logout', '/auth/providers'
    ];

    const staticAssetPrefixes = ['/assets/', '/claude-logo.png', '/favicon.svg', '/manifest.json', '/sw.js'];

    // Handle SPA routing - serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      // Skip API routes and backend auth routes
      if (
        req.path.startsWith('/api') ||
        backendAuthRoutes.some(r => req.path.startsWith(r)) ||
        staticAssetPrefixes.some(prefix => req.path.startsWith(prefix))
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
