import assert from 'node:assert/strict';
import {
  buildOpenCodePermissionRules,
  CLI_PROVIDERS,
  getProviderCapabilities,
} from '../src/services/cli-providers.js';
import {
  classifyAttachment,
  extensionForAttachment,
  sanitizeAttachmentFilename,
} from '../src/services/attachments.js';
import {
  buildOpenCodePromptText,
  OPENCODE_WEBUI_SESSION_ARG,
} from '../src/services/opencode/sessionContext.js';
import { getProviderLabelForModel } from '../../shared/src/types/cli-providers.js';
import { estimateModelCost, resolveModelPricing } from '../../shared/src/types/llm-pricing.js';

function testProviderLabels() {
  assert.equal(getProviderLabelForModel('gpt-5.5'), 'Codex');
  assert.equal(getProviderLabelForModel('claude-sonnet-4-20250514'), 'Claude');
  assert.equal(getProviderLabelForModel('z-ai/glm-5.1'), 'OpenCode');
  assert.equal(getProviderLabelForModel('glm-4.7'), 'OpenCode');
  assert.equal(getProviderLabelForModel('mistral-vibe-cli-latest'), 'Vibe');
  assert.equal(getProviderLabelForModel('unknown-model'), 'Other');
}

function testProviderCapabilities() {
  for (const provider of Object.values(CLI_PROVIDERS)) {
    const caps = getProviderCapabilities(provider.id);
    assert.equal(caps.streaming, provider.supportsStreamJson, provider.id);
    assert.equal(caps.resume, provider.supportsResume, provider.id);
    assert.equal(caps.modes, provider.supportsModes, provider.id);
  }
  assert.equal(getProviderCapabilities('codex').nativeVision, true);
  assert.equal(getProviderCapabilities('opencode').imageBridge, true);
  assert.equal(getProviderCapabilities('vibe').usageLimits, 'local-budget');
}

function testOpenCodeAllowedDirectories() {
  const rules = buildOpenCodePermissionRules('manual', {
    workingDirectory: '/workspace/project',
    allowedDirectories: ['/mnt/shared'],
  });
  assert.deepEqual(
    rules.filter((rule) => rule.permission === 'external_directory' && rule.action === 'allow'),
    [
      { permission: 'external_directory', pattern: '/workspace/project', action: 'allow' },
      { permission: 'external_directory', pattern: '/workspace/project/**', action: 'allow' },
      { permission: 'external_directory', pattern: '/mnt/shared', action: 'allow' },
      { permission: 'external_directory', pattern: '/mnt/shared/**', action: 'allow' },
    ]
  );
}

function testAttachmentNormalization() {
  assert.equal(classifyAttachment('image/png', 'shot.png'), 'image');
  assert.equal(classifyAttachment('application/pdf', 'paper.pdf'), 'pdf');
  assert.equal(classifyAttachment('application/octet-stream', 'README.md'), 'text');
  assert.equal(extensionForAttachment('image/jpeg'), 'jpg');
  assert.equal(sanitizeAttachmentFilename('../bad name?.png'), '.._bad_name_.png');
}

function testOpenCodePromptContext() {
  const text = buildOpenCodePromptText('Generate an image', 'webui-session-1');
  assert.match(text, /Plum WebUI session id: webui-session-1/);
  assert.match(text, new RegExp(OPENCODE_WEBUI_SESSION_ARG));
  assert.ok(text.endsWith('Generate an image'));
}

function testPricingTable() {
  assert.deepEqual(resolveModelPricing('gpt-5.5')?.input, 5);
  assert.deepEqual(resolveModelPricing('gpt-5.4-mini')?.output, 4.5);
  assert.deepEqual(resolveModelPricing('claude-opus-4-8')?.input, 5);
  assert.deepEqual(resolveModelPricing('claude-opus-4.7')?.output, 25);
  assert.deepEqual(resolveModelPricing('anthropic/claude-opus-4.5')?.cacheWrite, 6.25);
  assert.deepEqual(resolveModelPricing('claude-opus-4-1-20250805')?.input, 15);
  assert.deepEqual(resolveModelPricing('claude-opus-4.1')?.output, 75);
  assert.deepEqual(resolveModelPricing('claude-sonnet-4.6')?.cacheRead, 0.3);
  assert.deepEqual(resolveModelPricing('anthropic/claude-sonnet-4.5')?.output, 15);
  assert.deepEqual(resolveModelPricing('claude-haiku-4.5')?.cacheWrite, 1.25);
  assert.deepEqual(resolveModelPricing('claude-3.5-haiku-20241022')?.input, 0.8);
  assert.deepEqual(resolveModelPricing('z-ai/glm-5.1')?.cacheRead, 0.26);
  assert.deepEqual(resolveModelPricing('glm-4.7')?.output, 2.2);
  assert.deepEqual(resolveModelPricing('gemini-3.1-pro-preview')?.cacheRead, 0.2);
  assert.deepEqual(resolveModelPricing('mistral-vibe-cli-latest')?.output, 7.5);
  assert.deepEqual(resolveModelPricing('devstral-small-latest')?.input, 0.1);

  const estimate = estimateModelCost(
    'gpt-5.5',
    {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 0,
    },
    null
  );
  assert.equal(estimate.known, true);
  assert.equal(estimate.cost, 35.5);

  const unknownEstimate = estimateModelCost('unknown-model', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  assert.equal(unknownEstimate.known, false);
  assert.equal(unknownEstimate.cost, 0);
}

testProviderLabels();
testProviderCapabilities();
testOpenCodeAllowedDirectories();
testAttachmentNormalization();
testOpenCodePromptContext();
testPricingTable();

console.log('provider regression tests passed');
