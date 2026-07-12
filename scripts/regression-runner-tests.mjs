import assert from 'node:assert/strict';
import fs from 'node:fs';

import { REGRESSION_SUITES, runRegressionSuites } from './run-regression-tests.mjs';

const expectedSuites = [
  'regression runner',
  'android MCP device selection',
  'providers',
  'superpowers',
  'design.md',
  'style previews',
  'managed skills',
  'project instructions',
  'android emulator',
  'docker',
  'appearance themes',
  'operations view state',
];

assert.deepEqual(
  REGRESSION_SUITES.map((suite) => suite.name),
  expectedSuites,
  'the aggregate runner must cover every repository regression suite'
);

const calls = [];
const exitCodes = [1, 0, 2];
const result = await runRegressionSuites(
  REGRESSION_SUITES.slice(0, 3),
  async (suite) => {
    calls.push(suite.name);
    return exitCodes[calls.length - 1];
  },
  { log() {}, error() {} }
);

assert.deepEqual(calls, expectedSuites.slice(0, 3), 'a failed suite must not hide later suites');
assert.deepEqual(
  result.failures.map(({ name, exitCode }) => ({ name, exitCode })),
  [
    { name: 'regression runner', exitCode: 1 },
    { name: 'providers', exitCode: 2 },
  ]
);

const rootPackage = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
assert.equal(rootPackage.scripts.test, 'node scripts/run-regression-tests.mjs');

console.log('regression runner tests passed');
