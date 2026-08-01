import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'codex-usage-test-session-secret-00000000000000';
process.env.JWT_SECRET = 'codex-usage-test-jwt-secret-000000000000000';

const { clearCodexUsageCacheForTests, fetchCodexUsage, mapCodexUsage } =
  await import('../src/utils/codexUsage.js');

const normalWindows = mapCodexUsage({
  rate_limit: {
    primary_window: { used_percent: 12, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 34, limit_window_seconds: 604_800 },
  },
});
assert.equal(normalWindows.fiveHour?.utilization, 12);
assert.equal(normalWindows.sevenDay?.utilization, 34);

const weeklyOnly = mapCodexUsage({
  rate_limit: {
    primary_window: { used_percent: 56, limit_window_seconds: 604_800 },
  },
});
assert.equal(weeklyOnly.fiveHour, null);
assert.equal(weeklyOnly.sevenDay?.utilization, 56);

const originalFetch = globalThis.fetch;
const auth = {
  tokens: {
    access_token: 'test-access-token',
    account_id: 'account-1',
  },
};

try {
  clearCodexUsageCacheForTests();
  process.env.CODEX_USAGE_CACHE_TTL_MS = '60000';
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(
      JSON.stringify({
        plan_type: 'pro',
        rate_limit: { primary_window: { used_percent: 12 } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const [first, second] = await Promise.all([fetchCodexUsage(auth), fetchCodexUsage(auth)]);
  assert.deepEqual(first, second);
  assert.equal(requests, 1, 'parallel callers should share one upstream request');

  await fetchCodexUsage(auth);
  assert.equal(requests, 1, 'a fresh result should be served from cache');

  clearCodexUsageCacheForTests();
  process.env.CODEX_USAGE_TIMEOUT_MS = '20';
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('abort timeout did not fire')), 1_000);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(guard);
        reject(new Error('request aborted'));
      });
    });
  await assert.rejects(fetchCodexUsage(auth), /aborted/);
} finally {
  globalThis.fetch = originalFetch;
  clearCodexUsageCacheForTests();
  delete process.env.CODEX_USAGE_CACHE_TTL_MS;
  delete process.env.CODEX_USAGE_TIMEOUT_MS;
}

console.log('codex usage cache regression tests passed');
