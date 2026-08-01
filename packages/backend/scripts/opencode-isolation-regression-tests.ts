import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOpenCodeServerProcessEnv,
  OpencodeServer,
  OpencodeServerRegistry,
  type OpencodeEvent,
} from '../src/services/opencode/OpencodeServer.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
} from '../src/services/opencode/tenantPaths.js';

class FakeTenantServer extends OpencodeServer {
  readonly calls: string[] = [];

  constructor(readonly ownerUserId: string) {
    super({ userId: ownerUserId });
  }

  override async ensureStarted(userId?: string): Promise<string> {
    assert.equal(userId, this.ownerUserId);
    this.calls.push('start');
    return `http://${this.ownerUserId}.test`;
  }

  override async createSession(
    _cwd: string,
    opts: Parameters<OpencodeServer['createSession']>[1] = {}
  ): Promise<string> {
    assert.equal(opts.userId, this.ownerUserId);
    this.calls.push('create');
    // Deliberately collide across tenants. Routing must still use userId.
    return 'same-remote-session-id';
  }

  override subscribe(_opencodeSessionId: string, _handler: (event: OpencodeEvent) => void): void {
    this.calls.push('subscribe');
  }

  override unsubscribe(_opencodeSessionId: string): void {
    this.calls.push('unsubscribe');
  }

  override async sendPrompt(
    _opencodeSessionId: string,
    opts: Parameters<OpencodeServer['sendPrompt']>[1]
  ): Promise<void> {
    assert.equal(opts.userId, this.ownerUserId);
    this.calls.push('prompt');
  }

  override async abort(_opencodeSessionId: string): Promise<void> {
    this.calls.push('abort');
  }

  override async replyQuestion(
    _requestId: string,
    _answers: unknown,
    _opencodeSessionId?: string
  ): Promise<boolean> {
    this.calls.push('question');
    return true;
  }

  override async restart(userId?: string): Promise<string | null> {
    assert.equal(userId, this.ownerUserId);
    this.calls.push('restart');
    return `http://${this.ownerUserId}.test`;
  }

  override async shutdown(): Promise<void> {
    this.calls.push('shutdown');
  }
}

function testTenantPathsArePrivateAndStable(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-opencode-isolation-'));
  const persistentRoot = path.join(tempRoot, 'persistent');
  const runtimeRoot = path.join(tempRoot, 'runtime');
  try {
    const first = resolveOpenCodeTenantPaths('../User A/ä', { persistentRoot, runtimeRoot });
    const same = resolveOpenCodeTenantPaths('../User A/ä', { persistentRoot, runtimeRoot });
    const second = resolveOpenCodeTenantPaths('User B', { persistentRoot, runtimeRoot });

    assert.deepEqual(first, same);
    assert.notEqual(first.rootDir, second.rootDir);
    assert.match(first.tenantKey, /^[a-f0-9]{32}$/);
    assert.equal(first.rootDir.startsWith(`${persistentRoot}${path.sep}`), true);
    assert.equal(first.sessionContextFile.startsWith(`${runtimeRoot}${path.sep}`), true);
    assert.equal(first.rootDir.includes('User A'), false);

    ensureOpenCodeTenantDirectories(first);
    for (const directory of [first.rootDir, first.configDir, first.dataDir]) {
      assert.equal(fs.statSync(directory).isDirectory(), true);
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(directory).mode & 0o077, 0);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function testServerEnvironmentDoesNotInheritBackendSecrets(): void {
  const env = buildOpenCodeServerProcessEnv({
    PATH: '/safe/bin',
    HOME: '/safe/home',
    HTTPS_PROXY: 'http://proxy.test',
    DATABASE_URL: 'secret-database-url',
    JWT_SECRET: 'secret-jwt',
    DOCKER_HOST: 'tcp://docker-socket-proxy:2375',
  });

  assert.equal(env.PATH, '/safe/bin');
  assert.equal(env.HOME, '/safe/home');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.test');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.DOCKER_HOST, undefined);
}

async function testRegistryRoutesCollidingSessionsByUser(): Promise<void> {
  const created = new Map<string, FakeTenantServer>();
  const registry = new OpencodeServerRegistry((userId) => {
    const server = new FakeTenantServer(userId);
    created.set(userId, server);
    return server;
  });

  await Promise.all([registry.ensureStarted('user-a'), registry.ensureStarted('user-b')]);
  assert.equal(registry.tenantCount, 2);
  assert.notEqual(registry.forUser('user-a'), registry.forUser('user-b'));
  assert.equal(registry.forUser('user-a'), created.get('user-a'));

  const [sessionA, sessionB] = await Promise.all([
    registry.createSession('/workspace/a', { userId: 'user-a' }),
    registry.createSession('/workspace/b', { userId: 'user-b' }),
  ]);
  assert.equal(sessionA, sessionB);

  registry.subscribe(sessionA, () => undefined, 'user-a');
  registry.subscribe(sessionB, () => undefined, 'user-b');
  await registry.sendPrompt(sessionA, { text: 'A', userId: 'user-a' });
  await registry.sendPrompt(sessionB, { text: 'B', userId: 'user-b' });
  await registry.abort(sessionB, 'user-b');
  assert.equal(await registry.replyQuestion('question-b', [['ok']], sessionB, 'user-b'), true);

  assert.equal(created.get('user-a')?.calls.filter((call) => call === 'prompt').length, 1);
  assert.equal(created.get('user-b')?.calls.filter((call) => call === 'prompt').length, 1);
  assert.equal(created.get('user-a')?.calls.includes('abort'), false);
  assert.equal(created.get('user-b')?.calls.includes('abort'), true);
  assert.equal(created.get('user-a')?.calls.includes('question'), false);
  assert.equal(created.get('user-b')?.calls.includes('question'), true);

  // An unscoped lookup is deliberately rejected when both tenants happen to
  // use the same remote session id.
  await registry.abort(sessionA);
  assert.equal(created.get('user-a')?.calls.includes('abort'), false);

  await registry.restart('user-a');
  assert.equal(created.get('user-a')?.calls.includes('restart'), true);
  assert.equal(created.get('user-b')?.calls.includes('restart'), false);

  await registry.shutdownAll();
  assert.equal(registry.tenantCount, 0);
  assert.equal(created.get('user-a')?.calls.includes('shutdown'), true);
  assert.equal(created.get('user-b')?.calls.includes('shutdown'), true);
}

testTenantPathsArePrivateAndStable();
testServerEnvironmentDoesNotInheritBackendSecrets();
await testRegistryRoutesCollidingSessionsByUser();

console.log('opencode isolation regression tests passed');
