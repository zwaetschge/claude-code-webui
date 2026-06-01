import 'dotenv/config';
import { randomBytes } from 'crypto';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  HOST: z.string().default('0.0.0.0'), // Default to 0.0.0.0 for Docker compatibility
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
  // Additional allowed CORS origins (comma-separated, for Docker/reverse proxy setups)
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ALLOWED_BASE_PATHS: z.string().default('/home,/Users'),
  // Claude OAuth (uses official Claude Code client ID) - enabled by default
  CLAUDE_OAUTH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  // User email for display (since Anthropic API is Cloudflare-protected)
  CLAUDE_USER_EMAIL: z.string().optional(),
  PREVIEW_HOSTNAME: z.string().optional(),
  // Shared secret proving a request originates from the local permission-prompt
  // hook script (or any other in-process CLI caller). Auto-generated per-process
  // if not provided so a fresh container boot gets a fresh secret.
  WEBUI_HOOK_SECRET: z.string().optional(),
  // Express `trust proxy` setting. Default trusts one hop (the reverse proxy
  // directly in front, e.g. nginx). Spoofing X-Forwarded-For becomes trivial
  // if this is set to `true` without a guarding proxy, which defeats IP-based
  // rate limiting. Accepts: integer hop count, "loopback", "linklocal",
  // "uniquelocal", "true"/"false", or a comma-separated list of IPs/CIDRs.
  TRUST_PROXY: z.string().default('1'),
  // Comma-separated email allowlist. Self-hosted single-tenant deployments must
  // gate signup so a stranger who finds the OAuth callback URL can't create an
  // account on someone else's Anthropic credential. Empty = no allowlist
  // (anyone with valid OAuth + basic-auth bypass can sign in — only safe behind
  // a private network or Authelia).
  AUTH_ALLOWED_EMAILS: z.string().optional(),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  const env = parsed.data;

  // Normalize `trust proxy` value. Express accepts booleans, numbers, or
  // strings — we distinguish at parse time so the app's `app.set` call can
  // pass the right type without re-parsing env each request.
  const trustProxyRaw = env.TRUST_PROXY.trim();
  let trustProxy: boolean | number | string;
  if (trustProxyRaw === 'true') {
    trustProxy = true;
  } else if (trustProxyRaw === 'false') {
    trustProxy = false;
  } else if (/^\d+$/.test(trustProxyRaw)) {
    trustProxy = Number(trustProxyRaw);
  } else {
    trustProxy = trustProxyRaw;
  }

  // Build allowed origins list
  const allowedOrigins = [env.FRONTEND_URL.toLowerCase()];
  if (env.CORS_ALLOWED_ORIGINS) {
    const additionalOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0);
    allowedOrigins.push(...additionalOrigins);
  }

  const allowedEmails = (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  return {
    port: parseInt(env.PORT, 10),
    host: env.HOST,
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
    allowedOrigins, // List of allowed CORS origins
    trustProxy,
    encryptionKey: env.ENCRYPTION_KEY,
    hookSecret: env.WEBUI_HOOK_SECRET || randomBytes(32).toString('hex'),
    allowedBasePaths: env.ALLOWED_BASE_PATHS.split(',').map((p) => p.trim()),
    previewHostname: env.PREVIEW_HOSTNAME?.toLowerCase(),
    auth: {
      // Empty array means "no allowlist" — every successful OAuth/basic-auth
      // login is accepted. Set AUTH_ALLOWED_EMAILS to lock down a public
      // deployment to known operators.
      allowedEmails,
    },
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
