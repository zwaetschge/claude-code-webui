import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AppError } from '../middleware/errorHandler.js';
import { CLI_PROVIDERS } from './cli-providers.js';
import { safeJsonParse } from '../utils/json.js';

const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_CAPTURED_OUTPUT_CHARS = 48_000;

export interface SessionIconPromptSession {
  name: string;
  workingDirectory: string;
}

export interface SessionIconProjectSignals {
  framework?: string | null;
  techStack?: string[] | null;
}

export interface CodexSessionIconCommand {
  command: string;
  args: string[];
  prompt: string;
  codexHome: string;
  cwd: string;
}

export interface GeneratedSessionIconImage {
  buffer: Buffer;
  ext: '.png' | '.jpg' | '.webp';
  prompt: string;
  outputPath: string;
}

interface GeneratedImageCandidate {
  path: string;
  ext: '.png' | '.jpg' | '.webp';
  mtimeMs: number;
  size: number;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanToolOutput(value: string): string {
  return compactText(value).slice(0, 1600);
}

function timeoutFromEnv(): number {
  const raw = Number.parseInt(process.env.SESSION_ICON_IMAGE_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function normalizeGeneratedExt(filePath: string): '.png' | '.jpg' | '.webp' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpeg') return '.jpg';
  if (ext === '.png' || ext === '.jpg' || ext === '.webp') return ext;
  return null;
}

function codexHomeFromProvider(): string {
  return CLI_PROVIDERS.codex.credentialsPath.replace(/^~/, os.homedir());
}

function uniquePath(parts: string[]): string {
  const seen = new Set<string>();
  return parts
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join(path.delimiter);
}

async function workingDirectoryOrFallback(candidate: string): Promise<string> {
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {
    // fall back below
  }
  return process.cwd();
}

async function shouldForceCodexChatGptAuth(codexHome: string): Promise<boolean> {
  try {
    const authPath = path.join(codexHome, 'auth.json');
    const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf8'), {});
    const hasTokens =
      typeof auth.tokens === 'object' &&
      auth.tokens !== null &&
      typeof (auth.tokens as { access_token?: unknown }).access_token === 'string';
    const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
    return hasTokens && !hasApiKey;
  } catch {
    return false;
  }
}

export function buildSessionIconImagePrompt(
  session: SessionIconPromptSession,
  prompt?: string | null,
  project?: SessionIconProjectSignals | null
): string {
  const projectName = path.basename(session.workingDirectory || '').trim() || session.name;
  const basePrompt =
    prompt?.trim() ||
    [
      `Create a polished square app icon for a developer workspace session named "${session.name}".`,
      `Project folder: "${projectName}".`,
      'Use a single centered abstract symbol that suggests software, tooling, and focused work.',
      'Modern premium icon, high contrast, crisp edges, dark transparent-looking background, subtle depth.',
      'No words, no letters, no numbers, no watermark, no UI screenshot, no tiny details.',
    ].join(' ');
  const signals = [
    project?.framework ? `Framework signal: ${project.framework}.` : null,
    project?.techStack?.length ? `Tech stack: ${project.techStack.slice(0, 4).join(', ')}.` : null,
  ].filter(Boolean);

  return compactText([basePrompt, ...signals].join(' '));
}

export function buildCodexSessionIconCommand(opts: {
  command: string;
  codexHome: string;
  cwd: string;
  prompt: string;
  forceChatGptAuth?: boolean;
}): CodexSessionIconCommand {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only'];
  if (opts.forceChatGptAuth) {
    args.push('--config', 'auth_mode="chatgpt"');
  }
  args.push('--cd', opts.cwd, `$imagegen ${opts.prompt}`);

  return {
    command: opts.command,
    args,
    prompt: opts.prompt,
    codexHome: opts.codexHome,
    cwd: opts.cwd,
  };
}

export async function listCodexGeneratedImages(
  codexHome: string
): Promise<GeneratedImageCandidate[]> {
  const root = path.join(codexHome, 'generated_images');
  const found: GeneratedImageCandidate[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = normalizeGeneratedExt(fullPath);
      if (!ext) continue;
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || stat.size <= 0) continue;
      found.push({ path: fullPath, ext, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
}

export function selectNewCodexGeneratedImage(
  before: GeneratedImageCandidate[],
  after: GeneratedImageCandidate[],
  startedAtMs: number
): GeneratedImageCandidate | null {
  const previous = new Set(before.map((candidate) => candidate.path));
  return (
    after.find((candidate) => !previous.has(candidate.path)) ||
    after.find((candidate) => candidate.mtimeMs >= startedAtMs - 1000) ||
    null
  );
}

async function runCodexSessionIconCommand(
  command: CodexSessionIconCommand,
  env: Record<string, string>,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: {
        ...process.env,
        ...env,
        HOME: os.homedir(),
        CODEX_HOME: command.codexHome,
        PATH: uniquePath([
          path.dirname(command.command),
          '/home/node/.npm-global/bin',
          '/opt/plum-cli/bin',
          '/usr/local/bin',
          '/usr/bin',
          process.env.PATH || '',
        ]),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new AppError('Session icon generation timed out', 504, 'ICON_GENERATION_TIMEOUT'));
    }, timeoutMs);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_CAPTURED_OUTPUT_CHARS)
        stdout = stdout.slice(-MAX_CAPTURED_OUTPUT_CHARS);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_CAPTURED_OUTPUT_CHARS)
        stderr = stderr.slice(-MAX_CAPTURED_OUTPUT_CHARS);
    });
    child.on('error', (err) => {
      finish(
        new AppError(
          `Codex imagegen could not start: ${err.message}`,
          500,
          'CODEX_IMAGEGEN_START_FAILED'
        )
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }

      const output = cleanToolOutput([stderr, stdout].filter(Boolean).join(' '));
      finish(
        new AppError(
          output ? `Codex imagegen failed: ${output}` : 'Codex imagegen failed',
          502,
          'CODEX_IMAGEGEN_FAILED'
        )
      );
    });
  });
}

export async function generateSessionIconImage(opts: {
  sessionId: string;
  session: SessionIconPromptSession;
  prompt?: string | null;
  project?: SessionIconProjectSignals | null;
  command?: string;
  codexHome?: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  forceChatGptAuth?: boolean;
}): Promise<GeneratedSessionIconImage> {
  void opts.sessionId;
  const codexHome = opts.codexHome || codexHomeFromProvider();
  const cwd = await workingDirectoryOrFallback(opts.cwd || opts.session.workingDirectory);
  const prompt = buildSessionIconImagePrompt(opts.session, opts.prompt, opts.project);
  const forceChatGptAuth = opts.forceChatGptAuth ?? (await shouldForceCodexChatGptAuth(codexHome));
  const command = buildCodexSessionIconCommand({
    command: opts.command || CLI_PROVIDERS.codex.command,
    codexHome,
    cwd,
    prompt,
    forceChatGptAuth,
  });
  const before = await listCodexGeneratedImages(codexHome);
  const startedAtMs = Date.now();

  await runCodexSessionIconCommand(command, opts.env || {}, opts.timeoutMs || timeoutFromEnv());

  const after = await listCodexGeneratedImages(codexHome);
  const generated = selectNewCodexGeneratedImage(before, after, startedAtMs);
  if (!generated) {
    throw new AppError(
      'Codex imagegen completed without a generated image file',
      502,
      'CODEX_IMAGEGEN_NO_OUTPUT'
    );
  }

  const buffer = await fs.readFile(generated.path);
  return {
    buffer,
    ext: generated.ext,
    prompt,
    outputPath: generated.path,
  };
}
