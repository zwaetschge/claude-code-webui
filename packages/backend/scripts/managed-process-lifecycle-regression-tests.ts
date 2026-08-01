import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  signalManagedProcess,
  spawnManagedProcess,
  terminateManagedProcess,
} from '../src/services/claude/processLifecycle.js';

type ExitResult = { code: number | null; signal: NodeJS.Signals | null };

function waitForOutputLine(child: ChildProcess, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => finish(new Error('Timed out waiting for child output')),
      timeoutMs
    );

    const finish = (error?: Error, line?: string) => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onEarlyExit);
      if (error) reject(error);
      else resolve(line ?? '');
    };
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      const newline = output.indexOf('\n');
      if (newline >= 0) finish(undefined, output.slice(0, newline));
    };
    const onError = (error: Error) => finish(error);
    const onEarlyExit = () => finish(new Error('Child exited before reporting readiness'));

    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onEarlyExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<ExitResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for child exit'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };

    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForMarkerLines(
  markerPath: string,
  expected: readonly string[],
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = fs.existsSync(markerPath)
      ? fs.readFileSync(markerPath, 'utf8').split('\n').filter(Boolean)
      : [];
    if (expected.every((entry) => lines.includes(entry))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for markers: ${expected.join(', ')}`);
}

async function testManagedSignalReachesGrandchild(tempDir: string): Promise<void> {
  if (process.platform === 'win32') return;

  const markerPath = path.join(tempDir, 'managed-group.txt');
  const grandchildScript = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {
      fs.appendFileSync(process.env.MARKER_PATH, 'grandchild\\n');
      process.exit(0);
    });
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const parentScript = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    grandchild.stdout.once('data', () => process.stdout.write(String(grandchild.pid) + '\\n'));
    process.on('SIGTERM', () => {
      fs.appendFileSync(process.env.MARKER_PATH, 'parent\\n');
      setTimeout(() => process.exit(0), 25);
    });
    setInterval(() => {}, 1000);
  `;
  const parent = spawnManagedProcess(process.execPath, ['-e', parentScript], {
    env: { ...process.env, MARKER_PATH: markerPath },
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  try {
    assert.match(await waitForOutputLine(parent), /^\d+$/, 'grandchild should report readiness');
    assert.equal(signalManagedProcess(parent, 'SIGTERM'), true);
    await waitForExit(parent);
    await waitForMarkerLines(markerPath, ['parent', 'grandchild']);
  } finally {
    signalManagedProcess(parent, 'SIGKILL');
  }
}

async function testUnmanagedChildFallback(tempDir: string): Promise<void> {
  const markerPath = path.join(tempDir, 'direct-child.txt');
  const script = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {
      fs.writeFileSync(process.env.MARKER_PATH, 'direct\\n');
      process.exit(0);
    });
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: { ...process.env, MARKER_PATH: markerPath },
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  try {
    assert.equal(await waitForOutputLine(child), 'ready');
    assert.equal(signalManagedProcess(child, 'SIGTERM'), true);
    await waitForExit(child);
    await waitForMarkerLines(markerPath, ['direct']);
  } finally {
    child.kill('SIGKILL');
  }
}

async function testTerminationEscalates(tempDir: string): Promise<void> {
  if (process.platform === 'win32') return;

  const markerPath = path.join(tempDir, 'escalation.txt');
  const script = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => fs.writeFileSync(process.env.MARKER_PATH, 'term\\n'));
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawnManagedProcess(process.execPath, ['-e', script], {
    env: { ...process.env, MARKER_PATH: markerPath },
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  try {
    assert.equal(await waitForOutputLine(child), 'ready');
    terminateManagedProcess(child, 50);
    const result = await waitForExit(child);
    await waitForMarkerLines(markerPath, ['term']);
    assert.equal(result.signal, 'SIGKILL', 'a process ignoring SIGTERM must be force-stopped');
  } finally {
    signalManagedProcess(child, 'SIGKILL');
  }
}

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-process-lifecycle-'));
  try {
    await testManagedSignalReachesGrandchild(tempDir);
    await testUnmanagedChildFallback(tempDir);
    await testTerminationEscalates(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('managed process lifecycle regression tests passed');
}

await main();
