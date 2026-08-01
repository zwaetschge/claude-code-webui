import assert from 'node:assert/strict';

import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'runner-access-test-session-secret-00000000000000';
process.env.JWT_SECRET = 'runner-access-test-jwt-secret-000000000000000';
delete process.env.CLI_RUNNER_ACCESS;
delete process.env.CLI_RUNNER_ALLOWED_EMAILS;

const { getRunnerAccessDecision } = await import('../src/utils/runnerAccess.js');

const database = new Database(':memory:');
database.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL
  )
`);
const insert = database.prepare('INSERT INTO users (id, email, role, status) VALUES (?, ?, ?, ?)');
insert.run('admin', 'admin@example.test', 'admin', 'active');
insert.run('user', 'user@example.test', 'user', 'active');
insert.run('suspended', 'suspended@example.test', 'admin', 'suspended');

assert.equal(getRunnerAccessDecision('admin', database).allowed, true);
assert.equal(getRunnerAccessDecision('user', database).allowed, false);
assert.match(getRunnerAccessDecision('user', database).reason || '', /admin-only/);
assert.equal(getRunnerAccessDecision('suspended', database).allowed, false);
assert.equal(getRunnerAccessDecision('missing', database).allowed, false);

process.env.CLI_RUNNER_ALLOWED_EMAILS = 'USER@example.test';
assert.equal(getRunnerAccessDecision('user', database).allowed, true);

delete process.env.CLI_RUNNER_ALLOWED_EMAILS;
process.env.CLI_RUNNER_ACCESS = 'trusted-users';
assert.equal(getRunnerAccessDecision('user', database).allowed, true);

database.close();
console.log('runner access regression tests passed');
