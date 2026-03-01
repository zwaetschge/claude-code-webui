import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { TaskRunner, TaskContext } from "../TaskManager";

// OAuth credentials — uses Gemini CLI's public installed-app credentials from env.
// Set GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET in docker-compose.yml.
const CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const REDIRECT_URI = "https://codeassist.google.com/authcode";
const CREDS_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json");

interface PendingAuth {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  codeVerifier: string;
}

let googleAuthLib: {
  OAuth2Client: new (opts: { clientId: string; clientSecret: string }) => GoogleOAuth2Client;
  CodeChallengeMethod: { S256: string };
} | null = null;

interface GoogleOAuth2Client {
  generateCodeVerifierAsync(): Promise<{ codeVerifier: string; codeChallenge: string }>;
  generateAuthUrl(opts: Record<string, unknown>): string;
  getToken(opts: Record<string, unknown>): Promise<{ tokens: Record<string, unknown> }>;
  setCredentials(creds: Record<string, unknown>): void;
  getAccessToken(): Promise<{ token?: string | null }>;
}

async function loadGoogleAuth() {
  if (googleAuthLib) return googleAuthLib;

  const basePaths = [
    path.join(process.env.NPM_GLOBAL_PREFIX || "/app/config/npm-global", "lib/node_modules/@google/gemini-cli/node_modules/google-auth-library"),
    path.join(os.homedir(), ".npm-global/lib/node_modules/@google/gemini-cli/node_modules/google-auth-library"),
  ];

  for (const p of basePaths) {
    try {
      const mod = await import(path.join(p, "build/src/index.js"));
      googleAuthLib = mod.default || mod;
      return googleAuthLib!;
    } catch {
      continue;
    }
  }
  throw new Error("google-auth-library not found. Is @google/gemini-cli installed?");
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = (await res.json()) as { email?: string };
      return info.email ?? null;
    }
  } catch { /* non-fatal */ }
  return null;
}

export class GeminiOAuthRunner implements TaskRunner {
  taskType = "gemini-oauth";

  private pendingAuths = new Map<string, PendingAuth>();

  async execute(
    taskId: string,
    _params: Record<string, unknown>,
    ctx: TaskContext
  ): Promise<unknown> {
    const gauth = await loadGoogleAuth();

    // Check for existing valid credentials
    try {
      const existing = JSON.parse(await fs.readFile(CREDS_PATH, "utf-8"));
      if (existing.refresh_token) {
        const client = new gauth.OAuth2Client({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
        client.setCredentials(existing);
        const { token } = await client.getAccessToken();
        if (token) {
          const email = await fetchUserEmail(token);
          return {
            status: "completed",
            email,
            message: `Already authenticated${email ? ` as ${email}` : ""}`,
          };
        }
      }
    } catch { /* no cached creds */ }

    // Start PKCE OAuth flow
    const client = new gauth.OAuth2Client({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const verifier = await client.generateCodeVerifierAsync();
    const state = crypto.randomBytes(32).toString("hex");

    const authUrl = client.generateAuthUrl({
      redirect_uri: REDIRECT_URI,
      access_type: "offline",
      scope: SCOPES,
      code_challenge_method: gauth.CodeChallengeMethod.S256,
      code_challenge: verifier.codeChallenge,
      state,
      prompt: "consent",
    });

    // Set status to awaiting_input and provide the URL
    ctx.setResult({ authUrl, status: "awaiting_browser" });
    ctx.setStatus("awaiting_input");
    ctx.setProgress("Waiting for authorization code");

    // Wait for user to provide the code
    const code = await new Promise<string>((resolve, reject) => {
      this.pendingAuths.set(taskId, {
        resolve,
        reject,
        codeVerifier: verifier.codeVerifier,
      });

      // 10 minute timeout
      setTimeout(() => {
        if (this.pendingAuths.has(taskId)) {
          this.pendingAuths.delete(taskId);
          reject(new Error("OAuth timed out waiting for authorization code (10 min)"));
        }
      }, 10 * 60 * 1000);
    });

    ctx.setProgress("Exchanging authorization code for tokens");
    ctx.setStatus("running");

    // Exchange code for tokens
    const { tokens } = await client.getToken({
      code,
      codeVerifier: verifier.codeVerifier,
      redirect_uri: REDIRECT_URI,
    });

    // Save credentials
    await fs.mkdir(path.dirname(CREDS_PATH), { recursive: true });
    await fs.writeFile(CREDS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });

    // Verify and get email
    client.setCredentials(tokens);
    const { token } = await client.getAccessToken();
    const email = token ? await fetchUserEmail(token) : null;

    return {
      status: "completed",
      email,
      message: `Authenticated${email ? ` as ${email}` : ""} successfully`,
    };
  }

  handleInput(taskId: string, data: unknown): void {
    const pending = this.pendingAuths.get(taskId);
    if (!pending) return;

    const code = typeof data === "object" && data !== null && "code" in data
      ? String((data as { code: string }).code).trim()
      : typeof data === "string"
        ? data.trim()
        : null;

    if (!code) {
      pending.reject(new Error("Invalid authorization code"));
    } else {
      pending.resolve(code);
    }

    this.pendingAuths.delete(taskId);
  }

  cancel(taskId: string): void {
    const pending = this.pendingAuths.get(taskId);
    if (pending) {
      pending.reject(new Error("Task cancelled"));
      this.pendingAuths.delete(taskId);
    }
  }
}
