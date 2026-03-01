#!/usr/bin/env node
/**
 * Standalone Gemini CLI OAuth Login
 *
 * Performs the Google OAuth flow for Gemini CLI without relying on the
 * Ink/React TUI that hangs in Docker containers. Saves credentials to
 * ~/.gemini/oauth_creds.json where Gemini CLI expects them.
 *
 * Usage:
 *   node scripts/gemini-oauth-login.mjs
 *
 * The script prints an authorization URL. Open it in a browser,
 * authorize, then paste the resulting code back here.
 */

import { createRequire } from "node:module";
import crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import url from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

// Use the google-auth-library bundled with Gemini CLI
const require = createRequire(
  path.join(
    process.env.NPM_GLOBAL_PREFIX ||
      "/mnt/user/appdata/claude-code-webui/config/npm-global",
    "lib/node_modules/@google/gemini-cli/node_modules/google-auth-library/build/src/index.js"
  )
);

let OAuth2Client, CodeChallengeMethod;
try {
  const gauth = require("google-auth-library");
  OAuth2Client = gauth.OAuth2Client;
  CodeChallengeMethod = gauth.CodeChallengeMethod;
} catch {
  // Fallback: try direct path
  const gauthPath = path.join(
    process.env.NPM_GLOBAL_PREFIX ||
      "/mnt/user/appdata/claude-code-webui/config/npm-global",
    "lib/node_modules/@google/gemini-cli/node_modules/google-auth-library"
  );
  const gauth = (await import(gauthPath + "/build/src/index.js")).default || (await import(gauthPath + "/build/src/index.js"));
  OAuth2Client = gauth.OAuth2Client;
  CodeChallengeMethod = gauth.CodeChallengeMethod;
}

// OAuth credentials — set via env vars GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET
const CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const CREDS_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json");
const SUCCESS_URL =
  "https://developers.google.com/gemini-code-assist/auth_success_gemini";
const FAILURE_URL =
  "https://developers.google.com/gemini-code-assist/auth_failure_gemini";

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function saveCredentials(tokens) {
  await fs.mkdir(path.dirname(CREDS_PATH), { recursive: true });
  await fs.writeFile(CREDS_PATH, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
  console.log(`\nCredentials saved to ${CREDS_PATH}`);
}

async function fetchUserEmail(accessToken) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      return info.email;
    }
  } catch {
    // non-fatal
  }
  return null;
}

// ── Mode 1: Local HTTP callback (when port binding works) ──────────
async function authWithLocalServer(client) {
  const port = await getAvailablePort();
  const host = process.env.OAUTH_CALLBACK_HOST || "0.0.0.0";
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString("hex");

  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║            Gemini CLI — OAuth Login                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization callback...\n");

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.includes("/oauth2callback")) {
          res.writeHead(301, { Location: FAILURE_URL });
          res.end();
          return;
        }
        const qs = new url.URL(req.url, `http://127.0.0.1:${port}`)
          .searchParams;

        if (qs.get("error")) {
          res.writeHead(301, { Location: FAILURE_URL });
          res.end();
          server.close();
          reject(new Error(`OAuth error: ${qs.get("error")}`));
          return;
        }
        if (qs.get("state") !== state) {
          res.end("State mismatch — possible CSRF attack");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        const code = qs.get("code");
        if (!code) {
          res.writeHead(301, { Location: FAILURE_URL });
          res.end();
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        const { tokens } = await client.getToken({
          code,
          redirect_uri: redirectUri,
        });
        client.setCredentials(tokens);

        res.writeHead(301, { Location: SUCCESS_URL });
        res.end();
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(301, { Location: FAILURE_URL });
        res.end();
        server.close();
        reject(err);
      }
    });

    server.listen(port, host, () => {
      // ready
    });
    server.on("error", reject);

    // 5 minute timeout
    setTimeout(() => {
      server.close();
      reject(new Error("Timeout waiting for OAuth callback (5 min)"));
    }, 5 * 60 * 1000);
  });
}

// ── Mode 2: Manual code entry (fallback) ───────────────────────────
async function authWithManualCode(client) {
  const redirectUri = "https://codeassist.google.com/authcode";
  const codeVerifier = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString("hex");

  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    scope: SCOPES,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeVerifier.codeChallenge,
    state,
    prompt: "consent",
  });

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║            Gemini CLI — OAuth Login (Manual)            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise((resolve) => {
    rl.question("Paste the authorization code here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!code) {
    throw new Error("No authorization code provided");
  }

  const { tokens } = await client.getToken({
    code,
    codeVerifier: codeVerifier.codeVerifier,
    redirect_uri: redirectUri,
  });

  return tokens;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  // Check if already authenticated
  try {
    const existing = JSON.parse(await fs.readFile(CREDS_PATH, "utf-8"));
    if (existing.refresh_token) {
      const client = new OAuth2Client({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });
      client.setCredentials(existing);
      const { token } = await client.getAccessToken();
      if (token) {
        const email = await fetchUserEmail(token);
        console.log(
          `Already authenticated${email ? ` as ${email}` : ""}. Credentials valid.`
        );
        console.log(`To re-authenticate, delete ${CREDS_PATH} and run again.`);
        process.exit(0);
      }
    }
  } catch {
    // No valid cached creds — continue with login
  }

  const client = new OAuth2Client({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });

  // Determine mode
  const useManual = process.argv.includes("--manual") || process.env.NO_BROWSER === "true";
  let tokens;

  try {
    if (useManual) {
      tokens = await authWithManualCode(client);
    } else {
      tokens = await authWithLocalServer(client);
    }
  } catch (err) {
    console.error("\nAuthentication failed:", err.message);
    if (!useManual) {
      console.log("\nTrying manual code entry as fallback...\n");
      tokens = await authWithManualCode(client);
    } else {
      process.exit(1);
    }
  }

  await saveCredentials(tokens);

  // Verify
  client.setCredentials(tokens);
  const { token } = await client.getAccessToken();
  const email = await fetchUserEmail(token);
  console.log(`\nAuthenticated${email ? ` as ${email}` : ""} successfully!`);
  console.log("Gemini CLI should now work.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
