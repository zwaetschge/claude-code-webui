/**
 * Admin / helper LLM invocations.
 *
 * One-shot text completion for internal WebUI features (commit messages,
 * summaries, etc.) — NOT the user's interactive session.
 *
 * Codex is the primary admin provider going forward. Anthropic is restricting
 * `claude -p` and moving to a credit system, so Claude is treated as a fallback.
 *
 * Order of preference: codex → opencode → vibe → claude.
 * Override via env `ADMIN_LLM_PROVIDER=codex|opencode|vibe|claude`.
 */

import { spawn } from 'child_process';
import { isProviderAvailable, type CLIProvider } from '../services/cli-providers';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from './codexDefaults';

const DEFAULT_ORDER: CLIProvider[] = ['codex', 'opencode', 'vibe', 'claude'];

interface RunOpts {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface ProviderRunner {
  command: string;
  args: (prompt: string) => string[];
  // Some CLIs (codex) accept the prompt as a positional arg; others
  // (claude) pass it via -p. This flag controls whether the prompt is
  // also piped on stdin as a safety net for very long prompts.
  pipeOnStdin?: boolean;
}

function buildRunner(provider: CLIProvider): ProviderRunner {
  switch (provider) {
    case 'codex':
      // `codex exec <prompt>` is the non-interactive one-shot mode.
      // --skip-git-repo-check lets it run in arbitrary working dirs.
      // --ephemeral skips persisting to ~/.codex/sessions/ so admin calls
      // (commit messages, summaries, etc.) don't pollute the resume picker.
      return {
        command: 'codex',
        args: (prompt) => [
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--sandbox',
          getCodexWebuiSandboxMode(),
          '-c',
          `approval_policy="${getCodexWebuiApprovalPolicy()}"`,
          prompt,
        ],
      };
    case 'opencode':
      // `opencode run "<prompt>"` is the non-interactive mode; no JSON
      // wrapper needed for plain text completion.
      return {
        command: 'opencode',
        args: (prompt) => ['run', prompt],
      };
    case 'vibe':
      // Vibe takes the prompt as a positional arg in non-interactive mode.
      return {
        command: 'vibe',
        args: (prompt) => ['--trust', prompt],
      };
    case 'claude':
    default:
      return {
        command: 'claude',
        args: (prompt) => ['--print', '-p', prompt],
        pipeOnStdin: false,
      };
  }
}

async function pickProvider(): Promise<CLIProvider | null> {
  const override = process.env.ADMIN_LLM_PROVIDER as CLIProvider | undefined;
  if (override && DEFAULT_ORDER.includes(override)) {
    if (await isProviderAvailable(override)) return override;
  }
  for (const provider of DEFAULT_ORDER) {
    if (await isProviderAvailable(provider)) return provider;
  }
  return null;
}

export interface AdminLLMResult {
  text: string;
  provider: CLIProvider;
}

/**
 * Run a one-shot prompt against the preferred admin LLM.
 *
 * Throws if no provider is available or if the CLI exits with no output.
 */
export async function runAdminLLM(prompt: string, opts: RunOpts = {}): Promise<AdminLLMResult> {
  const provider = await pickProvider();
  if (!provider) {
    throw new Error(
      'No admin LLM provider available (codex/opencode/vibe/claude). Run a CLI login first.'
    );
  }

  const runner = buildRunner(provider);
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return await new Promise<AdminLLMResult>((resolve, reject) => {
    const proc = spawn(runner.command, runner.args(prompt), {
      cwd: opts.cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${runner.command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (code !== 0 && !text) {
        reject(new Error(stderr.trim() || `${runner.command} exited with code ${code}`));
        return;
      }
      resolve({ text, provider });
    });

    if (runner.pipeOnStdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });
    }
  });
}
