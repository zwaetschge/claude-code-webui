import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as pty from "node-pty";
import os from "os";
import path from "path";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { CLI_PROVIDERS, type CLIProvider } from "../services/cli-providers";
import { getCliEnv } from "../utils/cliPaths";

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
// Each `/start` spawns a `pty.spawn` that keeps an interactive CLI resident
// for up to LOGIN_TTL_MS. Without caps, a single authed user could hold open
// hundreds of Node TUIs in parallel and exhaust container resources. Caps
// are applied against the active (non-terminated) sessions.
const MAX_LOGIN_SESSIONS_PER_USER = 2;
const MAX_LOGIN_SESSIONS_TOTAL = 10;
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

// Cap at 256 chars: real OAuth codes are <200. An upper bound here prevents an
// authed user from piping arbitrary multi-KB payloads into the PTY stdin.
const codeSchema = z.object({
  code: z.string().min(1).max(256),
});

// Per-provider login invocation. Claude drives its OAuth flow from inside its
// TUI via the /login slash command, so we spawn the CLI with ["/login"] as the
// first "prompt". OpenCode ships a dedicated `auth login` subcommand that walks
// the user through provider selection and credential entry. Codex has no
// interactive login path surfaced through the CLI today — it auths via files
// in ~/.codex — so it's excluded here.
const LOGIN_INVOCATION: Partial<Record<CLIProvider, readonly string[]>> = {
  claude: ["/login"],
  opencode: ["auth", "login"],
};

router.post("/:provider/start", requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const provider = (req.params.provider || "").toLowerCase() as CLIProvider;

  const invocationArgs = LOGIN_INVOCATION[provider];
  if (!invocationArgs) {
    throw new AppError(
      `CLI login is not supported for provider '${provider}'.`,
      400,
      "UNSUPPORTED_PROVIDER",
    );
  }

  const parsed = startSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  let activeForUser = 0;
  let activeTotal = 0;
  for (const existing of loginSessions.values()) {
    if (existing.proc && existing.status !== "completed" && existing.status !== "error") {
      activeTotal += 1;
      if (existing.userId === userId) activeForUser += 1;
    }
  }
  if (activeForUser >= MAX_LOGIN_SESSIONS_PER_USER) {
    throw new AppError(
      "You already have a CLI login in progress. Finish or wait for it to expire before starting another.",
      429,
      "LOGIN_CAP_USER",
    );
  }
  if (activeTotal >= MAX_LOGIN_SESSIONS_TOTAL) {
    throw new AppError(
      "Too many concurrent CLI logins on this server. Try again shortly.",
      429,
      "LOGIN_CAP_GLOBAL",
    );
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
    const env = {
      ...getCliEnv(),
      HOME: os.homedir(),
      TERM: "xterm-256color",
      FORCE_COLOR: "1",
    } as Record<string, string>;

    // Provider-specific env
    if (provider === "claude") {
      const configOverride = process.env.WEBUI_CONFIG_HOME || process.env.CLAUDE_CONFIG_HOME;
      if (configOverride) {
        env.CLAUDE_CONFIG_HOME = configOverride;
      }
    } else if (provider === "opencode") {
      // Point OpenCode at the same XDG paths the session spawner uses, so login
      // writes auth.json into the mounted volume and the resulting credentials
      // are visible to later runs (see Dockerfile symlinks into ~/.opencode).
      env.OPENCODE_CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
      env.OPENCODE_DATA_DIR = path.join(os.homedir(), ".local", "share", "opencode");
    }

    const loginArgs = [...invocationArgs];

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
  const waitTime = 600;
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
