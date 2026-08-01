import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-readiness-'));
const dataDirectory = path.join(root, 'data');
const configDirectory = path.join(root, 'config');
const frontendDirectory = path.join(root, 'frontend');
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(configDirectory, { recursive: true });
fs.mkdirSync(path.join(frontendDirectory, 'assets'), { recursive: true });
fs.writeFileSync(
  path.join(frontendDirectory, 'index.html'),
  '<!doctype html><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>'
);
fs.writeFileSync(path.join(frontendDirectory, 'assets/app.css'), 'body { color: black; }');
fs.writeFileSync(path.join(frontendDirectory, 'assets/app.js'), 'globalThis.appLoaded = true;');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'readiness-test-session-secret-00000000000000000';
process.env.JWT_SECRET = 'readiness-test-jwt-secret-000000000000000000';
process.env.ENCRYPTION_KEY = 'readiness-test-encryption-key-00000000000000';
process.env.WEBUI_DATA_DIR = dataDirectory;
process.env.WEBUI_CONFIG_HOME = configDirectory;
process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';

const { initDatabase } = await import('../src/db/index.js');
const { buildReadinessReport } = await import('../src/services/readiness.js');

const database = initDatabase();
const ready = buildReadinessReport(frontendDirectory);
assert.equal(ready.status, 'ready');
assert.equal(ready.checks.database?.ok, true);
assert.equal(ready.checks.dataDirectory?.ok, true);
assert.equal(ready.checks.configHome?.ok, true);
assert.equal(ready.checks.frontend?.ok, true);

fs.rmSync(path.join(frontendDirectory, 'assets/app.js'));
const missingAsset = buildReadinessReport(frontendDirectory);
assert.equal(missingAsset.status, 'not_ready');
assert.equal(missingAsset.checks.frontend?.ok, false);
assert.match(missingAsset.checks.frontend?.detail || '', /referenced asset is missing/);

fs.writeFileSync(path.join(frontendDirectory, 'assets/app.js'), 'globalThis.appLoaded = true;');
fs.writeFileSync(path.join(frontendDirectory, 'assets/app.css'), '');
const emptyAsset = buildReadinessReport(frontendDirectory);
assert.equal(emptyAsset.status, 'not_ready');
assert.equal(emptyAsset.checks.frontend?.ok, false);
assert.match(emptyAsset.checks.frontend?.detail || '', /frontend asset is empty/);

fs.writeFileSync(path.join(frontendDirectory, 'assets/app.css'), 'body { color: black; }');
fs.rmSync(path.join(frontendDirectory, 'index.html'));
const missingFrontend = buildReadinessReport(frontendDirectory);
assert.equal(missingFrontend.status, 'not_ready');
assert.equal(missingFrontend.checks.frontend?.ok, false);

database.close();
assert.equal(buildReadinessReport().checks.database?.ok, false);
fs.rmSync(root, { recursive: true, force: true });

console.log('readiness regression tests passed');
