import assert from 'node:assert/strict';

import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'sqlite-store-test-session-secret-000000000000000';
process.env.JWT_SECRET = 'sqlite-store-test-jwt-secret-000000000000000000';

const { SqliteSessionStore } = await import('../src/services/SqliteSessionStore.js');

const database = new Database(':memory:');
database.exec(`
  CREATE TABLE http_sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const store = new SqliteSessionStore(database);
const expires = new Date(Date.now() + 60_000);
const sessionData = {
  cookie: {
    originalMaxAge: 60_000,
    expires,
    httpOnly: true,
    path: '/',
  },
  passport: { user: 'user-1' },
};

function setSession(sid: string, data = sessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(sid, data as never, (error) => (error ? reject(error) : resolve()));
  });
}

function getSession(sid: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

function destroySession(sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store.destroy(sid, (error) => (error ? reject(error) : resolve()));
  });
}

database
  .prepare('INSERT INTO http_sessions (sid, data, expires_at) VALUES (?, ?, ?)')
  .run('expired-before-prune', '{}', Date.now() - 1);
await setSession('active');
assert.equal(
  database.prepare('SELECT 1 FROM http_sessions WHERE sid = ?').get('expired-before-prune'),
  undefined,
  'writes should opportunistically prune expired sessions'
);

const restored = (await getSession('active')) as typeof sessionData;
assert.equal(restored.passport.user, 'user-1');
assert.equal(new Date(restored.cookie.expires).getTime(), expires.getTime());

database
  .prepare('INSERT INTO http_sessions (sid, data, expires_at) VALUES (?, ?, ?)')
  .run('corrupt', '{not-json', Date.now() + 60_000);
assert.equal(await getSession('corrupt'), null, 'corrupt sessions must fail closed');
assert.equal(
  database.prepare('SELECT 1 FROM http_sessions WHERE sid = ?').get('corrupt'),
  undefined
);

database
  .prepare('INSERT INTO http_sessions (sid, data, expires_at) VALUES (?, ?, ?)')
  .run('expired', '{}', Date.now() - 1);
assert.equal(await getSession('expired'), null);

await destroySession('active');
assert.equal(await getSession('active'), null);

database.close();
console.log('sqlite session store regression tests passed');
