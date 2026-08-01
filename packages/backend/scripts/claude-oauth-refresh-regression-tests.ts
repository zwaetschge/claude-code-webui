import assert from 'node:assert/strict';
import { requestClaudeOAuthTokenRefresh } from '../src/utils/claudeOauth.js';

let capturedUrl = '';
let capturedInit: RequestInit | undefined;
const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  capturedUrl = String(url);
  capturedInit = init;
  return new Response(
    JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 28_800,
      refresh_token_expires_in: 2_592_000,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}) as typeof fetch;

const tokens = await requestClaudeOAuthTokenRefresh('old-refresh', mockFetch);

assert.equal(capturedUrl, 'https://platform.claude.com/v1/oauth/token');
assert.equal(capturedInit?.method, 'POST');
assert.equal(new Headers(capturedInit?.headers).get('Content-Type'), 'application/json');
assert.equal(new Headers(capturedInit?.headers).get('anthropic-beta'), 'oauth-2025-04-20');
assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
  grant_type: 'refresh_token',
  refresh_token: 'old-refresh',
  client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
});
assert.deepEqual(tokens, {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresIn: 28_800,
  refreshTokenExpiresIn: 2_592_000,
});

console.log('Claude OAuth refresh regression tests passed');
