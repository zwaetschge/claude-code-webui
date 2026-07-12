import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export const REGRESSION_SUITES = [
  {
    name: 'regression runner',
    command: 'node',
    args: ['scripts/regression-runner-tests.mjs'],
  },
  {
    name: 'android MCP device selection',
    command: 'node',
    args: ['scripts/android-builder-mcp-regression-tests.mjs'],
  },
  {
    name: 'providers',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:providers'],
  },
  {
    name: 'superpowers',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:superpowers'],
  },
  {
    name: 'design.md',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:design-md'],
  },
  {
    name: 'style previews',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:style-previews'],
  },
  {
    name: 'managed skills',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:managed-skills'],
  },
  {
    name: 'project instructions',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:project-instructions'],
  },
  {
    name: 'android emulator',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:android-emulator'],
  },
  {
    name: 'docker',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      'scripts/docker-regression-tests.ts',
    ],
  },
  {
    name: 'appearance themes',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/appearance-theme-tests.ts',
    ],
  },
  {
    name: 'operations view state',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/operations-view-state-tests.ts',
    ],
  },
];

function resolveCommand(suite) {
  if (suite.command === 'node') {
    return { command: process.execPath, args: suite.args };
  }

  const pnpmExec = process.env.npm_execpath || path.join(repoRoot, 'node_modules', '.bin', 'pnpm');
  if (/\.(?:c?js|mjs)$/.test(pnpmExec)) {
    return { command: process.execPath, args: [pnpmExec, ...suite.args] };
  }
  return { command: pnpmExec, args: suite.args };
}

function runCommand(suite) {
  const invocation = resolveCommand(suite);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[regression] ${suite.name}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export async function runRegressionSuites(
  suites = REGRESSION_SUITES,
  runSuite = runCommand,
  logger = console
) {
  const failures = [];
  for (const suite of suites) {
    logger.log(`[regression] running ${suite.name}`);
    const exitCode = await runSuite(suite);
    if (exitCode !== 0) {
      failures.push({ name: suite.name, exitCode });
      logger.error(`[regression] failed ${suite.name} (exit ${exitCode})`);
    }
  }
  return { failures };
}

async function main() {
  const { failures } = await runRegressionSuites();
  if (failures.length > 0) {
    console.error(
      `[regression] ${failures.length} suite(s) failed: ${failures.map(({ name }) => name).join(', ')}`
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[regression] all ${REGRESSION_SUITES.length} suites passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
