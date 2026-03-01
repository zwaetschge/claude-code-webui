import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as pty from "node-pty";
import os from "os";
import fs from "fs";
import path from "path";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { CLI_PROVIDERS, type CLIProvider } from "../services/cli-providers";
import { getCliEnv } from "../utils/cliPaths";
import { resolveConfigHome } from "../utils/configPaths";

const router = Router();

type LoginStatus = "starting" | "awaiting_code" | "completed" | "error";

interface LoginSession {
  id: string;
  userId: string;
  provider: CLIProvider;
  proc: pty.IPty | null;
  status: LoginStatus;
  output: string;
  loginUrl?: string;
  error?: string;
  exitCode?: number | null;
  createdAt: number;
  waiters: Array<() => void>;
}

const LOGIN_TTL_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 8000;
const URL_REGEX = /(https?:\/\/[^\s"'"'<>]+)/i;
const CODE_PROMPT_REGEX = /(enter|paste|type).*(code|verification|authorization)|device.*code/i;
const ALREADY_LOGGED_REGEX = /already\s+logged\s+in|already\s+signed\s+in/i;
const LOGIN_SUCCESS_REGEX = /successfully\s+(logged|signed|authenticated)|welcome|logged\s+in\s+as/i;

const loginSessions = new Map<string, LoginSession>();

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\[\?[0-9;]*[a-zA-Z]|\x1B\[[<>=][^\x1B]*[a-zA-Z]/g, "");
}

function appendOutput(session: LoginSession, chunk: string): void {
  const cleaned = stripAnsi(chunk);
  session.output = (session.output + cleaned).slice(-OUTPUT_LIMIT);

  if (!session.loginUrl) {
    const match = session.output.match(URL_REGEX);
    if (match) {
      session.loginUrl = match[1];
    }
  }

  if (session.status === "starting" && (session.loginUrl || CODE_PROMPT_REGEX.test(session.output))) {
    session.status = "awaiting_code";
  }

  if (ALREADY_LOGGED_REGEX.test(session.output) || LOGIN_SUCCESS_REGEX.test(session.output)) {
    session.status = "completed";
  }
}

function finalizeSession(session: LoginSession, exitCode: number | null): void {
  session.exitCode = exitCode;
  session.proc = null;

  if (session.status !== "completed") {
    session.status = exitCode === 0 ? "completed" : "error";
  }
  if (session.status === "error" && !session.error) {
    session.error = "CLI login failed";
  }

  if (session.waiters.length) {
    session.waiters.splice(0).forEach((notify) => notify());
  }
}

function waitForCompletion(session: LoginSession, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.status === "completed" || session.status === "error") {
      return resolve();
    }
    const timer = setTimeout(() => {
      const index = session.waiters.indexOf(notify);
      if (index >= 0) {
        session.waiters.splice(index, 1);
      }
      reject(new Error("Login timed out"));
    }, timeoutMs);
    const notify = () => {
      clearTimeout(timer);
      resolve();
    };
    session.waiters.push(notify);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const session of loginSessions.values()) {
    if (now - session.createdAt > LOGIN_TTL_MS) {
      try {
        session.proc?.kill();
      } catch {
        // Ignore cleanup errors.
      }
      loginSessions.delete(session.id);
    }
  }
}, 60 * 1000);

const startSchema = z.object({
  provider: z.string().optional(),
});

const codeSchema = z.object({
  code: z.string().min(1),
});

/**
 * Ensure Gemini settings.json has oauth-personal auth type
 */
function ensureGeminiOAuthConfig(): void {
  const geminiDir = resolveConfigHome("gemini");
  const settingsPath = path.join(geminiDir, "settings.json");
  try {
    fs.mkdirSync(geminiDir, { recursive: true });
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch { /* new file */ }
    if (!settings.security) settings.security = {};
    const sec = settings.security as Record<string, unknown>;
    if (!sec.auth) sec.auth = {};
    const auth = sec.auth as Record<string, unknown>;
    if (auth.selectedType !== "oauth-personal") {
      auth.selectedType = "oauth-personal";
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log("[cli-login] Set Gemini auth to oauth-personal");
    }
  } catch (e) {
    console.error("[cli-login] Failed to configure Gemini settings.json:", e);
  }
}

router.post("/:provider/start", requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const provider = (req.params.provider || "").toLowerCase() as CLIProvider;

  const supportedProviders = new Set(["claude", "gemini"]);
  if (!supportedProviders.has(provider)) {
    throw new AppError("CLI login is only supported for Claude and Gemini.", 400, "UNSUPPORTED_PROVIDER");
  }

  const parsed = startSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  const config = CLI_PROVIDERS[provider];
  const command = config?.command || provider;
  const loginId = nanoid();
  const session: LoginSession = {
    id: loginId,
    userId,
    provider,
    proc: null,
    status: "starting",
    output: "",
    createdAt: Date.now(),
    waiters: [],
  };

  try {
    // Gemini: configure settings.json for OAuth before starting
    if (provider === "gemini") {
      ensureGeminiOAuthConfig();
    }

    const env = {
      ...getCliEnv(),
      HOME: os.homedir(),
      TERM: "xterm-256color",
      FORCE_COLOR: "1",
    } as Record<string, string>;

    // Provider-specific env
    if (provider === "claude") {
      env.CLAUDE_CONFIG_HOME = resolveConfigHome(provider);
    } else if (provider === "gemini") {
      // Prevent Gemini CLI from relaunching itself (breaks PTY output)
      env.GEMINI_CLI_NO_RELAUNCH = "true";
      // Prevent browser launch attempt in Docker
      env.NO_BROWSER = "true";
      env.SANDBOX = "true";
    }

    // Provider-specific login args
    let loginArgs: string[];
    if (provider === "gemini") {
      // Gemini: start interactive session to trigger OAuth flow
      // Note: Gemini CLI v0.29+ may still hang as an Ink/React TUI in Docker.
      // Use the Gemini OAuth task delegation flow as a more reliable alternative.
      loginArgs = ["--prompt", "say ok"];
    } else {
      // Claude: dedicated /login command
      loginArgs = ["/login"];
    }

    const proc = pty.spawn(command, loginArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env,
    });

    session.proc = proc;
    loginSessions.set(loginId, session);

    proc.onData((data: string) => {
      appendOutput(session, data);
    });

    proc.onExit(({ exitCode }) => {
      finalizeSession(session, exitCode);
    });
  } catch (error) {
    session.status = "error";
    session.error = error instanceof Error ? error.message : "Failed to start CLI login";
    loginSessions.set(loginId, session);
  }

  // Wait a bit for the process to start and output the URL
  const waitTime = provider === "gemini" ? 3000 : 600;
  await new Promise((resolve) => setTimeout(resolve, waitTime));

  res.json({
    success: true,
    data: {
      id: session.id,
      status: session.status,
      loginUrl: session.loginUrl || null,
      output: session.output,
      error: session.error || null,
    },
  });
});

router.get("/:id", requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError("Login session not found", 404, "NOT_FOUND");
  }

  res.json({
    success: true,
    data: {
      id: session.id,
      status: session.status,
      loginUrl: session.loginUrl || null,
      output: session.output,
      error: session.error || null,
    },
  });
});

router.post("/:id/code", requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError("Login session not found", 404, "NOT_FOUND");
  }

  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  if (!session.proc) {
    return res.json({
      success: true,
      data: {
        id: session.id,
        status: session.status,
        loginUrl: session.loginUrl || null,
        output: session.output,
        error: session.error || null,
      },
    });
  }

  const code = parsed.data.code.trim();
  session.proc.write(code + "\r");

  try {
    await waitForCompletion(session, 60 * 1000);
  } catch (error) {
    session.status = "error";
    session.error = error instanceof Error ? error.message : "Login timed out";
  }

  res.json({
    success: true,
    data: {
      id: session.id,
      status: session.status,
      loginUrl: session.loginUrl || null,
      output: session.output,
      error: session.error || null,
    },
  });
});

export default router;
