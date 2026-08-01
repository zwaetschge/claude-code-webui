#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const allowedAdvisories = new Map([
  [
    'GHSA-qwww-vcr4-c8h2',
    'React Router advisory applies only to unstable RSC APIs; Plum uses declarative BrowserRouter.',
  ],
]);

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const frontendSource = collectSourceFiles('packages/frontend/src')
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const usesUnstableReactRouterRsc = [
  /@react-router\/(?:dev|rsc)/,
  /react-server-dom/,
  /unstable_[A-Za-z0-9_]*RSC/,
].some((pattern) => pattern.test(frontendSource));

const audit = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr || audit.stdout || 'pnpm audit returned no JSON output\n');
  process.exit(1);
}

const advisories = Object.values(report.advisories || {});
const blocking = advisories.filter(
  (advisory) => (severityRank[advisory.severity] ?? 0) >= severityRank.high
);
const rejected = blocking.filter((advisory) => {
  if (!allowedAdvisories.has(advisory.github_advisory_id)) return true;
  return advisory.github_advisory_id === 'GHSA-qwww-vcr4-c8h2' && usesUnstableReactRouterRsc;
});

if (rejected.length > 0) {
  for (const advisory of rejected) {
    console.error(
      `${advisory.severity.toUpperCase()} ${advisory.github_advisory_id}: ${advisory.title}`
    );
  }
  process.exit(1);
}

for (const advisory of blocking) {
  console.warn(
    `Audited exception ${advisory.github_advisory_id}: ${allowedAdvisories.get(advisory.github_advisory_id)}`
  );
}
console.log(`Production dependency audit passed (${advisories.length} advisories inspected).`);
