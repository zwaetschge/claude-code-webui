import assert from 'node:assert/strict';

import {
  extractCliDeviceCode,
  extractCliLoginUrl,
  resolveCliLoginInvocation,
  stripCliLoginAnsi,
} from '../src/utils/cliLoginOutput.js';

const codexOutput = [
  '\u001b[2mWelcome to Codex\u001b[0m',
  'Open this URL in your browser:',
  'https://auth.openai.com/codex/device',
  'Enter this one-time code:',
  'ABCD-1234',
].join('\n');

assert.equal(extractCliLoginUrl(codexOutput), 'https://auth.openai.com/codex/device');
assert.equal(extractCliDeviceCode(codexOutput), 'ABCD-1234');
assert.doesNotMatch(stripCliLoginAnsi(codexOutput), /\u001b/);

const claudeOutput =
  'Open https://claude.ai/oauth/authorize?code=true&state=opaque-value. Then paste the code here.';
assert.equal(
  extractCliLoginUrl(claudeOutput),
  'https://claude.ai/oauth/authorize?code=true&state=opaque-value'
);
assert.equal(extractCliDeviceCode(claudeOutput), null);

assert.equal(extractCliLoginUrl('No browser link yet.'), null);
assert.equal(extractCliDeviceCode('Authorization code: short-code'), null);

assert.deepEqual(resolveCliLoginInvocation('codex'), ['login', '--device-auth']);
assert.deepEqual(resolveCliLoginInvocation('claude'), ['auth', 'login']);
assert.equal(resolveCliLoginInvocation('zai'), null);

console.log('CLI login regression tests passed');
