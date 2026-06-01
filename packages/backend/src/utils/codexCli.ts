import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CLI_PROVIDERS } from '../services/cli-providers.js';
import { safeJsonParse } from './json.js';

const execFileAsync = promisify(execFile);

export interface CodexFeatureFlag {
  name: string;
  stage: string;
  enabled: boolean;
}

export interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  authMode: 'chatgpt' | 'api-key' | 'none';
  configHome: string;
}

function codexHome(): string {
  return CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
}

function codexEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: os.homedir(),
    CODEX_HOME: codexHome(),
  };
}

async function runCodex(args: string[], timeout = 15_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync(CLI_PROVIDERS.codex.command, args, {
    env: codexEnv(),
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  return `${stdout || ''}${stderr || ''}`.trim();
}

async function readCodexAuth(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path.join(codexHome(), 'auth.json'), 'utf-8');
    return safeJsonParse<Record<string, unknown>>(raw, {});
  } catch {
    return {};
  }
}

export async function getCodexStatus(): Promise<CodexStatus> {
  const home = codexHome();
  let version: string | undefined;
  let installed = false;

  try {
    version = (await runCodex(['--version'], 5_000)).split('\n')[0]?.trim();
    installed = true;
  } catch {
    installed = false;
  }

  const auth = await readCodexAuth();
  const tokens = auth.tokens;
  const hasChatGptToken =
    typeof tokens === 'object' &&
    tokens !== null &&
    typeof (tokens as { access_token?: unknown }).access_token === 'string';
  const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;

  return {
    installed,
    authenticated: hasChatGptToken || hasApiKey,
    version,
    authMode: hasChatGptToken ? 'chatgpt' : hasApiKey ? 'api-key' : 'none',
    configHome: home,
  };
}

export async function listCodexFeatures(): Promise<CodexFeatureFlag[]> {
  const output = await runCodex(['features', 'list'], 15_000);
  const features: CodexFeatureFlag[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('WARNING:')) continue;
    const match = trimmed.match(/^(\S+)\s{2,}(.+?)\s{2,}(true|false)$/);
    if (!match) continue;
    features.push({
      name: match[1]!,
      stage: match[2]!,
      enabled: match[3] === 'true',
    });
  }

  return features;
}

export async function setCodexFeature(name: string, enabled: boolean): Promise<CodexFeatureFlag[]> {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error('Invalid Codex feature name');
  }

  await runCodex(['features', enabled ? 'enable' : 'disable', name], 15_000);
  return listCodexFeatures();
}
