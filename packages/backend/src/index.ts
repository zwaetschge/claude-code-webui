import express from 'express';
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

async function main() {
  // Initialize database
  initDatabase();

  const app = express();

  // Trust proxy headers when behind nginx/reverse proxy
  // This enables proper handling of X-Forwarded-Proto, X-Forwarded-Host, etc.
  app.set('trust proxy', true);

  const httpServer = createServer(app);

  // Setup WebSocket
  const io = setupWebSocket(httpServer);

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests or matching frontend URL (case-insensitive)
        if (!origin || origin.toLowerCase() === config.frontendUrl.toLowerCase()) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all origins for Docker flexibility
        }
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
  app.use('/api/mcp-servers', mcpRoutes);
  app.use('/api/claude', claudeRoutes);
  app.use('/api/claude-config', claudeConfigRoutes);
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

  // Serve frontend static files in production
  if (config.isProduction) {
    const frontendPath = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(frontendPath));

    // Backend auth routes that should NOT be handled by SPA
    const backendAuthRoutes = [
      '/auth/github', '/auth/google', '/auth/claude', '/auth/dev',
      '/auth/dev-login', '/auth/me', '/auth/logout', '/auth/providers'
    ];

    // Handle SPA routing - serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      // Skip API routes and backend auth routes
      if (req.path.startsWith('/api') || backendAuthRoutes.some(r => req.path.startsWith(r))) {
        return next();
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  // Error handler
  app.use(errorHandler);

  // Start server
  httpServer.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    console.log(`Frontend URL: ${config.frontendUrl}`);
  });
}

main().catch(console.error);
