import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { CliProviderUpdateResponse, CLIProvider } from '@claude-code-webui/shared';
import { getCliEnv, getCliEnvForPrefix, getNpmPrefix } from '../utils/cliPaths.js';

const execAsync = promisify(exec);

export const CLI_UPDATE_PROVIDERS = ['claude', 'codex', 'gemini', 'glm', 'kimi', 'multi'] as const;

function getGlmPrefix(): string {
  return process.env.CLI_PROVIDER_GLM_PREFIX || path.join(os.homedir(), '.npm-glm');
}

const CLI_UPDATE_COMMANDS: Record<CLIProvider, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code@latest',
  codex: 'npm install -g @openai/codex@latest',
  gemini: 'npm install -g @google/gemini-cli@latest',
  glm: 'npm install -g @anthropic-ai/claude-code@latest',
  kimi: 'uv tool install --python 3.13 kimi-cli --upgrade',
  multi: 'echo "Multi-CLI has no update command - uses configured providers"',
};

let updateInFlight: Promise<CliProviderUpdateResponse> | null = null;

async function runUpdateCommand(command: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      env,
      cwd: os.homedir(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter((value) => value && value.length > 0).join('');
    return { output, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const output = [err.stdout, err.stderr, err.message].filter((value) => value && value.length > 0).join('\n');
    const exitCode = typeof err.code === 'number' ? err.code : null;
    return { output, exitCode };
  }
}

export async function runCliUpdates(providers?: CLIProvider[]): Promise<CliProviderUpdateResponse> {
  if (updateInFlight) {
    return updateInFlight;
  }

  updateInFlight = (async () => {
    const targetProviders = providers && providers.length > 0
      ? providers
      : [...CLI_UPDATE_PROVIDERS];

  const results: CliProviderUpdateResponse['results'] = [];
  for (const provider of targetProviders) {
    const isGlm = provider === 'glm';
    const prefix = isGlm ? getGlmPrefix() : getNpmPrefix();
    const env = isGlm ? getCliEnvForPrefix(prefix) : getCliEnv();
    await fs.mkdir(path.join(prefix, 'bin'), { recursive: true });
    await fs.mkdir(path.join(prefix, 'lib'), { recursive: true });

    const command = CLI_UPDATE_COMMANDS[provider];
    if (!command) {
      results.push({
        provider,
        command: '',
          output: 'No update command configured.',
          exitCode: null,
          status: 'failed',
        });
        continue;
      }

    const timeoutMs = provider === 'glm' ? 5 * 60 * 1000 : 5 * 60 * 1000;
    const { output, exitCode } = await runUpdateCommand(command, env, timeoutMs);
      results.push({
        provider,
        command,
        output,
        exitCode,
        status: exitCode === 0 ? 'updated' : 'failed',
      });
    }

    return { results };
  })();

  try {
    return await updateInFlight;
  } finally {
    updateInFlight = null;
  }
}
