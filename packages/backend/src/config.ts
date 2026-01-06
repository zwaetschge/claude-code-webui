import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  ENCRYPTION_KEY: z.string().optional(),
  ALLOWED_BASE_PATHS: z.string().default('/home,/Users'),
  // Claude OAuth (uses official Claude Code client ID) - enabled by default
  CLAUDE_OAUTH_ENABLED: z.string().optional().transform(v => v !== 'false'),
  // User email for display (since Anthropic API is Cloudflare-protected)
  CLAUDE_USER_EMAIL: z.string().optional(),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  const env = parsed.data;

  return {
    port: parseInt(env.PORT, 10),
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    sessionSecret: env.SESSION_SECRET,
    jwtSecret: env.JWT_SECRET,
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackUrl: env.GITHUB_CALLBACK_URL,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackUrl: env.GOOGLE_CALLBACK_URL,
    },
    frontendUrl: env.FRONTEND_URL,
    encryptionKey: env.ENCRYPTION_KEY,
    allowedBasePaths: env.ALLOWED_BASE_PATHS.split(',').map((p) => p.trim()),
    claude: {
      oauthEnabled: env.CLAUDE_OAUTH_ENABLED, // Enabled by default (set CLAUDE_OAUTH_ENABLED=false to disable)
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Official Claude Code client ID
      authorizationUrl: 'https://console.anthropic.com/oauth/authorize',
      tokenUrl: 'https://console.anthropic.com/api/oauth/token',
      scopes: 'org:create_api_key user:profile user:inference',
      userEmail: env.CLAUDE_USER_EMAIL, // Optional: set via CLAUDE_USER_EMAIL env var
    },
  };
}

export const config = loadConfig();
