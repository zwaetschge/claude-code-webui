import assert from 'node:assert/strict';
import {
  ACCOUNT_USAGE_LIMIT_PROVIDERS,
  getUsageLimitProviderForModel,
} from '../src/lib/providers.ts';

assert.deepEqual(ACCOUNT_USAGE_LIMIT_PROVIDERS, ['codex', 'claude', 'zai', 'kimi', 'alibaba']);

assert.equal(getUsageLimitProviderForModel('codex', 'gpt-5.5'), 'codex');
assert.equal(getUsageLimitProviderForModel('claude', 'sonnet'), 'claude');
assert.equal(getUsageLimitProviderForModel('zai', 'glm-5'), 'zai');

assert.equal(getUsageLimitProviderForModel('opencode', 'z-ai/glm-5.1'), 'zai');
assert.equal(getUsageLimitProviderForModel('pi', 'glm-5.1'), 'zai');
assert.equal(getUsageLimitProviderForModel('kimi', 'kimi-code/k3'), 'kimi');

assert.equal(getUsageLimitProviderForModel('opencode', 'opencode-go/qwen3.7-max'), null);
assert.equal(getUsageLimitProviderForModel('opencode', 'anthropic/claude-sonnet-5'), null);
assert.equal(getUsageLimitProviderForModel('pi', 'openai/gpt-5.5'), null);

console.log('Usage-limit provider regression tests passed');
