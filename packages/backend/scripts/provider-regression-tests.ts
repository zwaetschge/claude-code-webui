import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOpenCodePermissionRules,
  CLI_PROVIDERS,
  getCLIArgs,
  getProviderCapabilities,
  resolveCliProviderSelectedModel,
  resolveOpenCodeConfiguredModel,
} from '../src/services/cli-providers.js';
import {
  classifyAttachment,
  extensionForAttachment,
  sanitizeAttachmentFilename,
} from '../src/services/attachments.js';
import {
  buildOpenCodePromptText,
  buildOpenCodeRuntimePrompt,
  getOpenCodeBuildAgentPrompt,
  getOpenCodePrimaryAgent,
  isOpenCodeManagedBuildAgentPrompt,
  DEFAULT_OPENCODE_STYLE_PROMPT,
  OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER,
  OPENCODE_WEBUI_SESSION_ARG,
} from '../src/services/opencode/sessionContext.js';
import { applyOpenCodePrimaryAgentConfig } from '../src/utils/providerLinks.js';
import { buildWebuiOpenCodeProviderConfig } from '../src/utils/providerLinks.js';
import { getOpenCodeCredentialEnvVars } from '../src/utils/opencodeProviderKeys.js';
import { ensureDefaultClaudeMcpServers } from '../src/utils/mcpDefaults.js';
import {
  collectOpenCodePollCursor,
  extractOpenCodeAssistantErrorMessage,
  isTerminalOpenCodeAssistantMessage,
} from '../src/services/opencode/OpencodeServer.js';
import {
  getOpenCodeProviderCatalog,
  parseOpenCodeModelsCache,
} from '../src/utils/opencodeCatalog.js';
import {
  hasOpenCodeGoLocalUsage,
  mapZaiUsage,
  parseOpenCodeGoQuotaHtml,
} from '../src/routes/usage.js';
import { upsertProxyUserInDatabase } from '../src/utils/proxyUser.js';
import { syncCodexConfig } from '../src/utils/codexConfigSync.js';
import { resolveContextWindow } from '../src/utils/contextWindow.js';
import {
  ClaudeProcessManager,
  extractCodexSessionId,
  readLatestCodexContextSnapshot,
  readCodexThreadState,
} from '../src/services/claude/ClaudeProcessManager.js';
import { normalizeUsageSnapshot } from '../../shared/src/index.js';
import { getProviderLabelForModel } from '../../shared/src/types/cli-providers.js';
import { estimateModelCost, resolveModelPricing } from '../../shared/src/types/llm-pricing.js';

type ClaudeProcessManagerIo = ConstructorParameters<typeof ClaudeProcessManager>[0];

type EmittedSocketEvent = {
  event: string;
  data: unknown;
};

type UsageProcessStub = {
  outputBuffer: { push: (...args: unknown[]) => void };
  lastActivityAt: number;
  cliProvider: 'claude' | 'codex';
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheCreationTokens: number;
  turnOutputTokens: number;
  contextInputTokens?: number;
  contextCacheReadTokens?: number;
  contextCacheCreationTokens?: number;
  contextOutputTokens?: number;
  contextWindow: number;
  totalCostUsd: number;
  model: string;
};

type UsageHarness = {
  processes: Map<string, UsageProcessStub>;
  recordContextSnapshot: (sessionId: string, proc: UsageProcessStub) => void;
  emitUsage: (sessionId: string, proc: UsageProcessStub) => void;
};

type DisconnectProcessStub = {
  disconnectedAt: number | null;
};

type OpenCodeQueueProcessStub = {
  cliProvider: 'opencode';
  opencodeIdle: boolean;
  opencodeQueuedTurns: Array<{
    queueId: string;
    queuedAt: string;
    originalMessage: string;
    attachments?: unknown[];
  }>;
  currentToolName: string | null;
  currentActivitySummary: string | null;
  currentAgentType: string | null;
  currentAgentDescription: string | null;
  subagentRuns: Map<string, { status: 'started' | 'completed' | 'error' }>;
  isStreaming: boolean;
  mode: 'auto-accept';
  model: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  lastActivityAt: number;
  disconnectedAt: number | null;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

function asUsageHarness(manager: ClaudeProcessManager): UsageHarness {
  return manager as unknown as UsageHarness;
}

function asProcessStore<T>(manager: ClaudeProcessManager): { processes: Map<string, T> } {
  return manager as unknown as { processes: Map<string, T> };
}

function testProviderLabels() {
  assert.equal(getProviderLabelForModel('gpt-5.5'), 'Codex');
  assert.equal(getProviderLabelForModel('claude-sonnet-4-20250514'), 'Claude');
  assert.equal(getProviderLabelForModel('z-ai/glm-5.1'), 'OpenCode');
  assert.equal(getProviderLabelForModel('glm-4.7'), 'OpenCode');
  assert.equal(getProviderLabelForModel('mistral-vibe-cli-latest'), 'Vibe');
  assert.equal(getProviderLabelForModel('unknown-model'), 'Other');
}

function testContextWindowFallbacks() {
  assert.equal(resolveContextWindow('gpt-5.5'), 256_000);
  assert.equal(resolveContextWindow('gpt-5.5-pro'), 256_000);
  assert.equal(resolveContextWindow('gpt-5.4'), 196_000);
  assert.equal(resolveContextWindow('gpt-5.4-mini'), 128_000);
  assert.equal(resolveContextWindow('gpt-5.3-codex'), 400_000);
}

function testUsageWindowNormalization() {
  const staleCodexUsage = normalizeUsageSnapshot({
    sessionId: 'session-1',
    inputTokens: 5_764,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 5_764,
    contextWindow: 256_000,
    contextUsedPercent: 2,
    contextUsedPercentRaw: 2,
    contextExceeded: false,
    totalCostUsd: 0,
    model: 'gpt-5.5',
  });

  assert.equal(staleCodexUsage?.contextWindow, 256_000);
  assert.equal(staleCodexUsage?.contextUsedPercent, 2);
  assert.equal(staleCodexUsage?.contextUsedPercentRaw, 2);
  assert.equal(staleCodexUsage?.contextExceeded, false);

  const unknownUsage = normalizeUsageSnapshot({
    sessionId: 'session-2',
    inputTokens: 1_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 1_000,
    contextWindow: 256_000,
    contextUsedPercent: 0,
    totalCostUsd: 0,
    model: 'custom-model',
  });

  assert.equal(unknownUsage?.contextWindow, 256_000);

  const overWindowUsage = normalizeUsageSnapshot({
    sessionId: 'session-3',
    inputTokens: 309_100,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 309_100,
    contextWindow: 256_000,
    contextUsedPercent: 100,
    contextUsedPercentRaw: 121,
    contextExceeded: true,
    totalCostUsd: 0,
    model: 'gpt-5.5',
  });

  assert.equal(overWindowUsage?.totalTokens, 256_000);
  assert.equal(overWindowUsage?.contextUsedPercent, 100);
  assert.equal(overWindowUsage?.contextUsedPercentRaw, 100);
  assert.equal(overWindowUsage?.contextExceeded, false);
}

function testContextUsageIncludesAssistantOutput() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-context';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'claude',
    turnInputTokens: 1_000,
    turnCacheReadTokens: 50,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 250,
    contextInputTokens: undefined,
    contextCacheReadTokens: undefined,
    contextCacheCreationTokens: undefined,
    contextWindow: 2_000,
    totalCostUsd: 0.5,
    model: 'custom-model',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | { totalTokens?: number; contextUsedPercent?: number }
    | undefined;

  assert.equal(usage?.totalTokens, 1_300);
  assert.equal(usage?.contextUsedPercent, 65);
}

function testCodexUsageUsesNormalizedContextWindow() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-codex-context';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'codex',
    turnInputTokens: 3_000,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    contextInputTokens: 3_000,
    contextCacheReadTokens: 0,
    contextCacheCreationTokens: 0,
    contextWindow: 258_400,
    totalCostUsd: 0.5,
    model: 'gpt-5.5',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | { contextWindow?: number; contextUsedPercent?: number }
    | undefined;

  assert.equal(usage?.contextWindow, 256_000);
  assert.equal(usage?.contextUsedPercent, 1);
}

function testContextUsageCapsAtWindow() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-context-cap';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'codex',
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    contextInputTokens: 309_100,
    contextCacheReadTokens: 0,
    contextCacheCreationTokens: 0,
    contextOutputTokens: 0,
    contextWindow: 256_000,
    totalCostUsd: 0.5,
    model: 'gpt-5.5',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | {
        totalTokens?: number;
        contextUsedPercent?: number;
        contextUsedPercentRaw?: number;
        contextExceeded?: boolean;
      }
    | undefined;

  assert.equal(usage?.totalTokens, 256_000);
  assert.equal(usage?.contextUsedPercent, 100);
  assert.equal(usage?.contextUsedPercentRaw, 100);
  assert.equal(usage?.contextExceeded, false);
}

function testCodexFreshExecUsageDoesNotDelta() {
  const ioStub = {
    to: () => ({
      emit: () => undefined,
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;

  const sessionId = 'session-codex-fresh-exec';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexLastReportedTokens: { input: 1_000, cached: 100, output: 50 },
    codexSawTokenCountThisTurn: true,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
  });

  const translated = managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 2_000,
      cached_input_tokens: 500,
      output_tokens: 100,
      reasoning_output_tokens: 25,
    },
  }) as { usage?: Record<string, number> } | null;

  assert.equal(translated?.usage?.input_tokens, 1_500);
  assert.equal(translated?.usage?.cache_read_input_tokens, 500);
  assert.equal(translated?.usage?.output_tokens, 125);
}

async function createCodexStateFixture(opts: {
  cwd: string;
  threadId: string;
  tokensUsed: number;
  prompt: string;
  updatedAtMs?: number;
}): Promise<string> {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-state-fixture-'));
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  const db = new Database(dbPath);
  const updatedAtMs = opts.updatedAtMs ?? Date.now();
  const updatedAt = Math.floor(updatedAtMs / 1000);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL DEFAULT 'enabled',
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      thread_source TEXT,
      preview TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(
    `
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
      cli_version, first_user_message, memory_mode, model, created_at_ms,
      updated_at_ms, preview
    ) VALUES (?, ?, ?, ?, 'exec', 'openai', ?, ?, 'workspace-write', 'on-request', ?, 0, 0,
      '0.130.0', ?, 'enabled', 'gpt-5.5', ?, ?, ?)
  `
  ).run(
    opts.threadId,
    path.join(codexHome, 'sessions', `${opts.threadId}.jsonl`),
    updatedAt,
    updatedAt,
    opts.cwd,
    opts.prompt,
    opts.tokensUsed,
    opts.prompt,
    updatedAtMs,
    updatedAtMs,
    opts.prompt
  );
  db.close();
  return codexHome;
}

async function testCodexThreadStateReaderMatchesPrompt() {
  const prompt = '[Prior conversation context]\nUser asks about context window';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId: 'thread-state-reader',
    tokensUsed: 251_634,
    prompt,
  });

  try {
    const state = readCodexThreadState(codexHome, {
      cwd: '/workspace/plum',
      sinceMs: Date.now() - 1_000,
      promptPrefix: prompt.slice(0, 80),
    });

    assert.equal(state?.id, 'thread-state-reader');
    assert.equal(state?.tokensUsed, 251_634);
    assert.equal(state?.match, 'prompt');
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextSnapshotReadsRolloutTokenCount() {
  const threadId = 'thread-context-rollout';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId,
    tokensUsed: 5_000_000,
    prompt: '[Prior conversation context]\nRollout token counts',
  });
  const rolloutPath = path.join(codexHome, 'sessions', `${threadId}.jsonl`);

  try {
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-06-17T20:20:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 207_620,
                cached_input_tokens: 189_824,
                output_tokens: 720,
              },
              model_context_window: 258_400,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:21:00.000Z',
          type: 'compacted',
          payload: { message: '', replacement_history: [] },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:21:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
              },
              model_context_window: 258_400,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:22:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 72_000,
                cached_input_tokens: 30_000,
                output_tokens: 1_000,
              },
              model_context_window: 258_400,
            },
          },
        }),
      ].join('\n'),
      'utf8'
    );

    const snapshot = readLatestCodexContextSnapshot(codexHome, {
      threadId,
      cwd: '/workspace/plum',
    });

    assert.equal(snapshot?.threadId, threadId);
    assert.equal(snapshot?.counters.input, 72_000);
    assert.equal(snapshot?.counters.cached, 30_000);
    assert.equal(snapshot?.counters.output, 1_000);
    assert.equal(snapshot?.contextWindow, 256_000);
    assert.equal(snapshot?.recordedAt, '2026-06-17T20:22:00.000Z');
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextFallbackUsesThreadState() {
  const prompt = '[Prior conversation context]\nLong WebUI turn';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum-code',
    threadId: 'thread-context-fallback',
    tokensUsed: 251_634,
    prompt,
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;

  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-thread-state-fallback';
  const proc: Record<string, unknown> = {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    codexLastPromptEstimateTokens: 8_422,
    codexLastPromptPrefix: prompt,
    codexExecStartedAtMs: Date.now() - 1_000,
    codexSessionId: 'thread-context-fallback',
    claudeSessionId: 'thread-context-fallback',
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  };

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    managerPrivate.processes.set(sessionId, proc);
    managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.completed',
      usage: {
        input_tokens: 348_027,
        cached_input_tokens: 264_704,
        output_tokens: 5_029,
        reasoning_output_tokens: 0,
      },
    });

    const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
    const usage = usageEvent?.data as { totalTokens?: number; contextUsedPercent?: number };

    assert.equal(proc.codexSessionId, 'thread-context-fallback');
    assert.equal(usage?.totalTokens, 251_634);
    assert.equal(usage?.contextUsedPercent, 98);
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextFallbackCapsThreadStateAtWindow() {
  const prompt = '[Prior conversation context]\nOver-window WebUI turn';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum-code',
    threadId: 'thread-context-over-window',
    tokensUsed: 309_100,
    prompt,
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;

  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-thread-state-cap';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    codexLastPromptEstimateTokens: 8_422,
    codexLastPromptPrefix: prompt,
    codexExecStartedAtMs: Date.now() - 1_000,
    codexSessionId: 'thread-context-over-window',
    claudeSessionId: 'thread-context-over-window',
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.completed',
      usage: {
        input_tokens: 348_027,
        cached_input_tokens: 264_704,
        output_tokens: 5_029,
        reasoning_output_tokens: 0,
      },
    });

    const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
    const usage = usageEvent?.data as {
      totalTokens?: number;
      contextUsedPercent?: number;
      contextUsedPercentRaw?: number;
      contextExceeded?: boolean;
    };

    assert.equal(usage?.totalTokens, 256_000);
    assert.equal(usage?.contextUsedPercent, 100);
    assert.equal(usage?.contextUsedPercentRaw, 100);
    assert.equal(usage?.contextExceeded, false);
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

function testCodexCompactEventRetainsCompactedContext() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-compact-retained';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'context.compacted',
    usage: {
      input_tokens: 40_000,
      cached_input_tokens: 10_000,
      output_tokens: 2_000,
    },
  });
  managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 309_100,
      cached_input_tokens: 0,
      output_tokens: 1_000,
      reasoning_output_tokens: 0,
    },
  });

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
        contextExceeded?: boolean;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 30_000);
  assert.equal(latest?.cacheReadTokens, 10_000);
  assert.equal(latest?.outputTokens, 2_000);
  assert.equal(latest?.totalTokens, 42_000);
  assert.equal(latest?.contextUsedPercent, 16);
  assert.equal(latest?.contextExceeded, false);
}

function testCodexImplicitCompactDetectedFromContextDrop() {
  const emitted: EmittedSocketEvent[] = [];
  const compactEvents: unknown[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = (...args: unknown[]) => {
    compactEvents.push(args[1]);
  };
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-implicit-compact';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: true,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn_context',
    summary: 'auto',
    model: 'gpt-5.5',
  });
  assert.equal(compactEvents.length, 0);

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 244_000,
        cached_input_tokens: 200_000,
        output_tokens: 2_000,
      },
    },
  });
  assert.equal(compactEvents.length, 0);

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 72_000,
        cached_input_tokens: 30_000,
        output_tokens: 1_000,
      },
    },
  });

  assert.equal(compactEvents.length, 1);
  assert.match((compactEvents[0] as { message?: string }).message || '', /compacted prior context/);

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 42_000);
  assert.equal(latest?.cacheReadTokens, 30_000);
  assert.equal(latest?.outputTokens, 1_000);
  assert.equal(latest?.totalTokens, 73_000);
  assert.equal(latest?.contextUsedPercent, 29);
}

function testCodexImplicitCompactDetectedFromMidWindowReset() {
  const emitted: EmittedSocketEvent[] = [];
  const compactEvents: unknown[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = (...args: unknown[]) => {
    compactEvents.push(args[1]);
  };
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-implicit-compact-mid-window';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: true,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 206_000,
        cached_input_tokens: 180_000,
        output_tokens: 2_000,
      },
    },
  });
  assert.equal(compactEvents.length, 0);

  managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  assert.equal(compactEvents.length, 1);
  assert.match((compactEvents[0] as { message?: string }).message || '', /compacted prior context/);

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 0);
  assert.equal(latest?.cacheReadTokens, 0);
  assert.equal(latest?.outputTokens, 0);
  assert.equal(latest?.totalTokens, 0);
  assert.equal(latest?.contextUsedPercent, 0);
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

function testCodexFastTierArgs() {
  const fastXhigh = getCLIArgs('codex', {
    serviceTier: 'fast',
    reasoningLevel: 'xhigh',
  });
  assert.equal(fastXhigh.includes('--profile'), false);
  assert.equal(fastXhigh.includes('--model'), false);
  assert.equal(fastXhigh.includes('gpt-5.4'), false);
  assert.ok(fastXhigh.includes('service_tier="fast"'));
  assert.ok(fastXhigh.includes('model_reasoning_effort="xhigh"'));

  const explicitModel = getCLIArgs('codex', {
    model: 'gpt-5.5',
    serviceTier: 'fast',
    reasoningLevel: 'xhigh',
  });
  assert.ok(explicitModel.includes('gpt-5.5'));
  assert.equal(explicitModel.includes('gpt-5.4'), false);
  assert.ok(explicitModel.includes('service_tier="fast"'));
  assert.ok(explicitModel.includes('model_reasoning_effort="xhigh"'));
}

function testOpenCodeConfiguredModelAllowList() {
  assert.equal(
    resolveOpenCodeConfiguredModel('z-ai/glm-5.1', ['z-ai/glm-5.1', 'openai/gpt-5.2']),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveOpenCodeConfiguredModel('ollama/qwopus', ['z-ai/glm-5.1', 'openai/gpt-5.2']),
    'z-ai/glm-5.1'
  );
  assert.equal(resolveOpenCodeConfiguredModel('ollama/qwopus', []), 'ollama/qwopus');
  assert.equal(resolveOpenCodeConfiguredModel(null, ['openai/gpt-5.2']), 'openai/gpt-5.2');
}

function testOpenCodeZaiCredentialAliases() {
  const envVars = getOpenCodeCredentialEnvVars('z-ai', {
    'z-ai': {
      name: 'Z-AI',
      models: ['glm-5.1'],
      description: 'test',
      env: ['ZAI_API_KEY'],
      source: 'fallback',
    },
  });

  assert.ok(envVars.includes('ZAI_API_KEY'));
  assert.ok(envVars.includes('ZHIPU_API_KEY'));
  assert.ok(envVars.includes('Z_AI_API_KEY'));
}

function testOpenCodeWebuiProviderConfig() {
  const block = buildWebuiOpenCodeProviderConfig(
    {
      id: 'z-ai',
      name: 'Z-AI',
      apiKey: 'encrypted-secret',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      enabled: true,
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z',
    },
    {
      'z-ai': {
        name: 'Z-AI',
        models: ['glm-5.1', 'glm-5'],
        description: 'test',
        env: ['ZAI_API_KEY'],
        api: 'https://api.z.ai/api/coding/paas/v4',
        source: 'fallback',
      },
    }
  );

  assert.ok(block);
  assert.equal(block?.npm, '@ai-sdk/openai-compatible');
  assert.equal(block?.api, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(block?.options?.baseURL, 'https://api.z.ai/api/coding/paas/v4');
  assert.ok(block?.env?.includes('ZAI_API_KEY'));
  assert.ok(block?.env?.includes('ZHIPU_API_KEY'));
  assert.ok(block?.models?.['glm-5.1']);
  assert.equal(block?.options?.apiKey, '{env:ZAI_API_KEY}');
  assert.notEqual(block?.options?.apiKey, 'encrypted-secret');

  const defaultUrlBlock = buildWebuiOpenCodeProviderConfig(
    {
      id: 'z-ai',
      name: 'Z-AI',
      apiKey: 'encrypted-secret',
      enabled: true,
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z',
    },
    {
      'z-ai': {
        name: 'Z-AI',
        models: ['glm-5.1'],
        description: 'test',
        env: ['ZAI_API_KEY'],
        api: 'https://api.z.ai/api/coding/paas/v4',
        source: 'fallback',
      },
    }
  );

  assert.equal(defaultUrlBlock?.api, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(defaultUrlBlock?.options?.baseURL, 'https://api.z.ai/api/coding/paas/v4');
}

function testOpenCodeSessionModelSelection() {
  const configured = ['z-ai/glm-5.1', 'openai/gpt-5.2', 'moonshot/kimi-k2'];

  assert.equal(
    resolveCliProviderSelectedModel('opencode', 'z-ai/glm-5.1', configured, 'openai/gpt-5.2'),
    'openai/gpt-5.2'
  );
  assert.equal(
    resolveCliProviderSelectedModel('opencode', 'z-ai/glm-5.1', configured, null),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveCliProviderSelectedModel('opencode', 'z-ai/glm-5.1', configured, 'unknown/model'),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveCliProviderSelectedModel('codex', 'gpt-5.5', ['gpt-5.4'], 'gpt-5.4'),
    'gpt-5.4'
  );
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
  const previousStyle = process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
  const previousAgent = process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
  try {
    delete process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
    delete process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
    const text = buildOpenCodePromptText('Generate an image', 'webui-session-1');
    assert.match(text, /Plum Code WebUI communication contract:/);
    assert.match(text, /capable colleague/);
    assert.match(text, /Plum WebUI session id: webui-session-1/);
    assert.match(text, new RegExp(OPENCODE_WEBUI_SESSION_ARG));
    assert.ok(text.endsWith('Generate an image'));

    const styleOnly = buildOpenCodePromptText('Plain turn');
    assert.match(styleOnly, new RegExp(DEFAULT_OPENCODE_STYLE_PROMPT.split('\n')[0]));
    assert.ok(styleOnly.endsWith('Plain turn'));

    const contextual = buildOpenCodePromptText('Implement the fix', {
      webuiSessionId: 'webui-session-2',
      mode: 'planning',
      reasoningLevel: 'xhigh',
    });
    assert.match(contextual, /Mode is planning/);
    assert.match(contextual, /Effort is max/);
    assert.match(contextual, /webui-session-2/);

    process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = '';
    const emptyEnvStyle = buildOpenCodePromptText('Empty env turn');
    assert.match(emptyEnvStyle, /capable colleague/);
    assert.ok(emptyEnvStyle.endsWith('Empty env turn'));

    process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = 'Use terse test style.';
    const custom = buildOpenCodePromptText('Custom turn');
    assert.match(custom, /Use terse test style\./);
    assert.doesNotMatch(custom, /capable colleague/);

    process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = '0';
    assert.equal(buildOpenCodePromptText('No style'), 'No style');
    assert.match(
      buildOpenCodePromptText('Runtime only', { mode: 'auto-accept', reasoningLevel: 'low' }),
      /Mode is auto-accept/
    );
  } finally {
    if (previousStyle === undefined) {
      delete process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
    } else {
      process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = previousStyle;
    }
    if (previousAgent === undefined) {
      delete process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
    } else {
      process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT = previousAgent;
    }
  }
}

function testOpenCodeRuntimePrompt() {
  assert.match(buildOpenCodeRuntimePrompt({ mode: 'manual' }), /Mode is manual/);
  assert.match(buildOpenCodeRuntimePrompt({ reasoningLevel: 'extra-high' }), /Effort is max/);
  assert.match(buildOpenCodeRuntimePrompt({ reasoningLevel: 'medium' }), /Effort is medium/);
  assert.equal(buildOpenCodeRuntimePrompt(), '');
}

function testOpenCodePrimaryAgentConfig() {
  const previousStyle = process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
  const previousAgent = process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
  try {
    delete process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
    delete process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;

    assert.equal(getOpenCodePrimaryAgent(), 'build');
    assert.match(
      getOpenCodeBuildAgentPrompt(),
      new RegExp(OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER)
    );

    const config: Record<string, unknown> = {};
    applyOpenCodePrimaryAgentConfig(config);
    const build = (config.agent as Record<string, Record<string, unknown>>).build;
    assert.equal(build.mode, 'primary');
    assert.equal(build.description, 'Primary Plum Code WebUI coding agent.');
    assert.match(String(build.prompt), /capable colleague/);

    process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = '';
    const emptyEnvConfig: Record<string, unknown> = {};
    applyOpenCodePrimaryAgentConfig(emptyEnvConfig);
    const emptyEnvBuild = (emptyEnvConfig.agent as Record<string, Record<string, unknown>>).build;
    assert.match(String(emptyEnvBuild.prompt), /capable colleague/);

    const customConfig: Record<string, unknown> = {
      agent: { build: { mode: 'primary', prompt: 'Keep my own build prompt.' } },
    };
    applyOpenCodePrimaryAgentConfig(customConfig);
    const customBuild = (customConfig.agent as Record<string, Record<string, unknown>>).build;
    assert.equal(customBuild.prompt, 'Keep my own build prompt.');

    const oldManagedConfig: Record<string, unknown> = {
      agent: {
        build: {
          prompt: '<!-- plum-webui-opencode-style-v2 -->\nold managed prompt',
        },
      },
    };
    applyOpenCodePrimaryAgentConfig(oldManagedConfig);
    const oldManagedBuild = (oldManagedConfig.agent as Record<string, Record<string, unknown>>)
      .build;
    assert.match(
      String(oldManagedBuild.prompt),
      new RegExp(OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER)
    );
    assert.equal(isOpenCodeManagedBuildAgentPrompt(String(oldManagedBuild.prompt)), true);

    process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = '0';
    const disabledConfig: Record<string, unknown> = {
      agent: {
        build: {
          prompt: `<!-- ${OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER} -->\nold managed prompt`,
        },
      },
    };
    applyOpenCodePrimaryAgentConfig(disabledConfig);
    const disabledBuild = (disabledConfig.agent as Record<string, Record<string, unknown>>).build;
    assert.equal(disabledBuild.prompt, undefined);
  } finally {
    if (previousStyle === undefined) {
      delete process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
    } else {
      process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT = previousStyle;
    }
    if (previousAgent === undefined) {
      delete process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
    } else {
      process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT = previousAgent;
    }
  }
}

function testOpenCodeModelsCacheParsing() {
  const catalog = parseOpenCodeModelsCache(
    JSON.stringify({
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        api: 'https://api.openai.com/v1',
        models: {
          'gpt-5.2': { id: 'gpt-5.2', name: 'GPT 5.2' },
          'gpt-4o': { name: 'GPT-4o' },
        },
      },
      upstage: {
        id: 'upstage',
        name: 'Upstage',
        env: ['UPSTAGE_API_KEY'],
        models: {
          'solar-pro3': { id: 'solar-pro3' },
        },
      },
    })
  );

  assert.deepEqual(catalog.openai?.models, ['gpt-5.2', 'gpt-4o']);
  assert.equal(catalog.openai?.env?.[0], 'OPENAI_API_KEY');
  assert.equal(catalog.openai?.source, 'models.dev');
  assert.ok(Object.keys(catalog).indexOf('openai') < Object.keys(catalog).indexOf('upstage'));
}

function testOpenCodeFallbackCatalogIncludesKimiK27() {
  const catalog = getOpenCodeProviderCatalog();

  assert.ok(catalog['opencode-go']?.models.includes('kimi-k2.7'));
  assert.ok(catalog.opencode?.models.includes('kimi-k2.7'));
}

function testZaiUsageTrackerQuotaShape() {
  const mapped = mapZaiUsage(
    {
      limits: [
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          currentValue: 120_000,
          usage: 1_000_000,
          percentage: 12,
          nextResetTime: 1_778_000_000_000,
        },
        {
          type: 'TIME_LIMIT',
          currentValue: 2,
          usage: 10,
          percentage: 20,
          nextResetTime: 1_778_010_000_000,
        },
      ],
    },
    [{ productName: 'GLM Coding Pro', status: 'VALID', inCurrentPeriod: true }]
  );

  assert.equal(mapped?.subscriptionType, 'GLM Coding Pro');
  assert.equal(mapped?.fiveHour?.utilization, 12);
  assert.equal(mapped?.fiveHour?.used, 120_000);
  assert.equal(mapped?.fiveHour?.limit, 1_000_000);
  assert.equal(mapped?.fiveHour?.windowSeconds, 18_000);
  assert.equal(mapped?.additional?.[0]?.name, 'Web search');
  assert.equal(mapped?.additional?.[0]?.unit, 'requests');
}

function testOpenCodeGoMonitorHtmlShape() {
  const snapshot = parseOpenCodeGoQuotaHtml(
    'rollingUsage:$R[30]={status:"ok",resetInSec:17562,usagePercent:1},' +
      'weeklyUsage:$R[31]={status:"ok",resetInSec:533388,usagePercent:5},' +
      'monthlyUsage:$R[32]={status:"ok",resetInSec:2485309,usagePercent:19}'
  );

  assert.equal(snapshot?.source, 'scraping');
  assert.equal(snapshot?.rolling.usagePercent, 1);
  assert.equal(snapshot?.weekly.resetsInSeconds, 533_388);
  assert.equal(snapshot?.monthly.usagePercent, 19);
  assert.equal(parseOpenCodeGoQuotaHtml('<html>No quota here</html>'), null);

  const resetFirst = parseOpenCodeGoQuotaHtml(
    'rollingUsage:$R[30]={resetInSec:3600,usagePercent:7.5},' +
      'weeklyUsage:$R[31]={resetInSec:7200,usagePercent:2.25},' +
      'monthlyUsage:$R[32]={resetInSec:14400,usagePercent:16.75}'
  );
  assert.equal(resetFirst?.rolling.usagePercent, 7.5);
  assert.equal(resetFirst?.weekly.resetsInSeconds, 7200);
  assert.equal(resetFirst?.monthly.usagePercent, 16.75);

  const dataSlot = parseOpenCodeGoQuotaHtml(`<div data-slot="usage">
    <div data-slot="usage-item">
      <span data-slot="usage-label">Rolling Usage</span>
      <span data-slot="usage-value"><!--$-->1<!--/-->%</span>
      <span data-slot="reset-time"><!--$-->Resets in<!--/--> <!--$-->1 hour 56 minutes<!--/--></span>
    </div>
    <div data-slot="usage-item">
      <span data-slot="usage-label">Weekly Usage</span>
      <span data-slot="usage-value"><!--$-->2.5<!--/-->%</span>
      <span data-slot="reset-time"><!--$-->Resets in<!--/--> <!--$-->6 days 2 hours<!--/--></span>
    </div>
    <div data-slot="usage-item">
      <span data-slot="usage-label">Monthly Usage</span>
      <span data-slot="usage-value"><!--$-->0<!--/-->%</span>
      <span data-slot="reset-now"><!--$-->reset-now<!--/--></span>
    </div>
  </div>`);
  assert.equal(dataSlot?.rolling.resetsInSeconds, 6960);
  assert.equal(dataSlot?.weekly.usagePercent, 2.5);
  assert.equal(dataSlot?.monthly.resetsInSeconds, 0);
}

function testOpenCodeGoLocalEstimateRequiresUsage() {
  assert.equal(hasOpenCodeGoLocalUsage([{ requests: 0 }, { requests: 0 }, { requests: 0 }]), false);
  assert.equal(hasOpenCodeGoLocalUsage([{ requests: 0 }, { requests: 1 }, { requests: 0 }]), true);
}

function testOpenCodeTerminalMessageDetection() {
  const providerError = {
    info: {
      id: 'msg-error',
      role: 'assistant',
      error: {
        name: 'APIError',
        data: {
          message: 'Model qwen3.7-max is not supported for format oa-compat',
          statusCode: 401,
          responseBody:
            '{"type":"error","error":{"type":"ModelError","message":"Model qwen3.7-max is not supported for format oa-compat"}}',
        },
      },
      time: { completed: 1781991715787 },
    },
    parts: [],
  };

  assert.equal(
    extractOpenCodeAssistantErrorMessage(providerError),
    'Model qwen3.7-max is not supported for format oa-compat'
  );
  assert.equal(isTerminalOpenCodeAssistantMessage(providerError), true);

  assert.equal(
    isTerminalOpenCodeAssistantMessage({
      info: { role: 'assistant', finish: 'unknown', time: { completed: 1780863102766 } },
      parts: [
        { type: 'reasoning', text: 'Thinking' },
        {
          type: 'tool',
          state: { status: 'error', error: 'Tool execution aborted' },
        },
        { type: 'step-finish' },
      ],
    }),
    true
  );
  assert.equal(
    isTerminalOpenCodeAssistantMessage({
      info: { role: 'assistant', finish: 'unknown' },
      parts: [{ type: 'reasoning', text: 'Still working' }],
    }),
    false
  );
}

function testOpenCodePollCursorPriming() {
  const cursor = collectOpenCodePollCursor([
    {
      info: { id: 'msg-old', role: 'assistant', finish: 'stop' },
      parts: [
        { id: 'text-old', type: 'text', text: 'Already shown' },
        { id: 'reasoning-old', type: 'reasoning', text: 'Internal reasoning' },
        { id: 'tool-old', type: 'tool', state: { status: 'completed' } },
        { id: 'finish-old', type: 'step-finish' },
      ],
    },
    {
      info: { id: 'msg-user', role: 'user' },
      parts: [{ id: 'user-text', type: 'text', text: 'Ignore me' }],
    },
    {
      info: {
        id: 'msg-error',
        role: 'assistant',
        error: { data: { message: 'Provider rejected the selected model' } },
      },
      parts: [],
    },
  ]);

  assert.equal(cursor.textLens.get('text-old'), 'Already shown'.length);
  assert.equal(cursor.textLens.get('reasoning-old'), 'Internal reasoning'.length);
  assert.equal(cursor.textLens.get('finish-old'), 1);
  assert.equal(cursor.textLens.has('user-text'), false);
  assert.equal(cursor.toolStatus.get('tool-old'), 'completed');
  assert.equal(cursor.finishedMessages.has('msg-old'), true);
  assert.equal(cursor.finishedMessages.has('msg-error'), true);
}

function testProxyUserAdoptsLegacySharedCliUser() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT DEFAULT 'dark',
      default_working_dir TEXT,
      allowed_tools TEXT,
      custom_system_prompt TEXT,
      settings_json TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.prepare(
    `INSERT INTO users (id, email, name, provider, provider_id, role)
     VALUES ('legacy-user', 'codex-user@local', 'Codex User', 'cli', 'local-cli', 'admin')`
  ).run();
  db.prepare(
    `INSERT INTO user_settings (user_id, theme, default_working_dir, allowed_tools, settings_json)
     VALUES ('legacy-user', 'system', '/mnt/user/AI/plum-code', '["Bash"]', '{"uiProvider":"plum"}')`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, user_id, name) VALUES ('session-1', 'legacy-user', 'Chat')`
  ).run();
  db.prepare(
    `INSERT INTO usage_history (user_id, session_id, input_tokens)
     VALUES ('legacy-user', 'session-1', 123)`
  ).run();

  const user = upsertProxyUserInDatabase(db, 'Valentin@Example.COM', 'Valentin', null);

  assert.equal(user.id, 'legacy-user');
  assert.equal(user.email, 'valentin@example.com');
  assert.equal(user.provider, 'proxy');
  assert.equal(user.providerId, 'valentin@example.com');
  assert.equal(db.prepare(`SELECT COUNT(*) as count FROM users`).get().count, 1);
  assert.deepEqual(
    db
      .prepare(`SELECT email, provider, provider_id, role FROM users WHERE id = 'legacy-user'`)
      .get(),
    {
      email: 'valentin@example.com',
      provider: 'proxy',
      provider_id: 'valentin@example.com',
      role: 'admin',
    }
  );
  assert.equal(
    db.prepare(`SELECT default_working_dir FROM user_settings WHERE user_id = 'legacy-user'`).get()
      .default_working_dir,
    '/mnt/user/AI/plum-code'
  );
  assert.equal(
    db.prepare(`SELECT user_id FROM sessions WHERE id = 'session-1'`).get().user_id,
    'legacy-user'
  );
  assert.equal(
    db.prepare(`SELECT user_id FROM usage_history WHERE session_id = 'session-1'`).get().user_id,
    'legacy-user'
  );
}

function testCodexSessionIdExtraction() {
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      id: '019eb1d8-cda2-7b82-9955-3c1c37e660d0',
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d0'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      sessionId: '019eb1d8-cda2-7b82-9955-3c1c37e660d1',
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d1'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      payload: { id: '019eb1d8-cda2-7b82-9955-3c1c37e660d2' },
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d2'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'thread.started',
      thread: { id: 'thread-123' },
    }),
    'thread-123'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'turn_context',
      id: 'ignored',
    }),
    null
  );
}

function testDisconnectedSessionStaysRunning() {
  const ioStub = {
    to: () => ({ emit: () => undefined }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const harness = asProcessStore<DisconnectProcessStub>(manager);
  const sessionId = 'headless-session';

  harness.processes.set(sessionId, { disconnectedAt: null });

  manager.markSessionDisconnected(sessionId);

  assert.equal(manager.isSessionRunning(sessionId), true);
  assert.notEqual(harness.processes.get(sessionId)?.disconnectedAt, null);
}

function testOpenCodeQueueStateAndRuntime() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo);
  const harness = asProcessStore<OpenCodeQueueProcessStub>(manager);
  const queueHarness = manager as unknown as {
    emitQueueState: (sessionId: string, proc: OpenCodeQueueProcessStub) => void;
  };
  const sessionId = 'opencode-queue-session';
  const proc: OpenCodeQueueProcessStub = {
    cliProvider: 'opencode',
    opencodeIdle: false,
    opencodeQueuedTurns: [
      {
        queueId: 'queued-1',
        queuedAt: '2026-06-13T22:00:00.000Z',
        originalMessage: 'follow-up while opencode is still working',
        attachments: [{ mimeType: 'text/plain' }],
      },
    ],
    currentToolName: null,
    currentActivitySummary: null,
    currentAgentType: null,
    currentAgentDescription: null,
    subagentRuns: new Map(),
    isStreaming: false,
    mode: 'auto-accept',
    model: 'z-ai/glm-5.1',
    workingDirectory: '/workspace/demo',
    claudeSessionId: 'remote-session',
    lastActivityAt: Date.now(),
    disconnectedAt: null,
  };

  harness.processes.set(sessionId, proc);
  queueHarness.emitQueueState(sessionId, proc);

  const queueEvent = emitted.find((entry) => entry.event === 'session:queue');
  assert.deepEqual(queueEvent?.data, {
    sessionId,
    provider: 'opencode',
    depth: 1,
    items: [
      {
        id: 'queued-1',
        preview: 'follow-up while opencode is still working',
        createdAt: '2026-06-13T22:00:00.000Z',
        attachments: 1,
      },
    ],
    busy: true,
    preempting: false,
  });

  const runtime = manager.getSessionRuntimeSnapshot(sessionId);
  assert.equal(runtime.queueDepth, 1);
  assert.equal(runtime.busy, true);
  assert.equal(runtime.activitySummary, '1 turn queued');
}

function testLatestContextSnapshotOrdering() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE session_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      context_window INTEGER NOT NULL DEFAULT 0,
      context_used_percent INTEGER NOT NULL DEFAULT 0,
      context_exceeded INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const createdAt = '2026-06-10 19:08:36.123';
  db.prepare(
    `
    INSERT INTO session_events (
      id, user_id, session_id, event_type, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      total_tokens, context_window, context_used_percent, context_exceeded,
      metadata_json, created_at
    ) VALUES (?, ?, ?, 'context_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    'ctx-old',
    'user-1',
    'session-1',
    'codex',
    'gpt-5.5',
    10,
    0,
    5,
    0,
    15,
    256_000,
    1,
    0,
    JSON.stringify({ cappedPercent: 1, totalCostUsd: 0.1 }),
    createdAt
  );

  db.prepare(
    `
    INSERT INTO session_events (
      id, user_id, session_id, event_type, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      total_tokens, context_window, context_used_percent, context_exceeded,
      metadata_json, created_at
    ) VALUES (?, ?, ?, 'context_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    'ctx-new',
    'user-1',
    'session-1',
    'codex',
    'gpt-5.5',
    20,
    0,
    8,
    0,
    28,
    256_000,
    2,
    0,
    JSON.stringify({ cappedPercent: 2, totalCostUsd: 0.2 }),
    createdAt
  );

  const latest = db
    .prepare(
      `
      SELECT id, total_tokens as totalTokens, context_used_percent as contextUsedPercent
      FROM session_events
      WHERE session_id = ? AND user_id = ? AND event_type = 'context_snapshot'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `
    )
    .get('session-1', 'user-1') as
    | { id: string; totalTokens: number; contextUsedPercent: number }
    | undefined;

  assert.equal(latest?.id, 'ctx-new');
  assert.equal(latest?.totalTokens, 28);
  assert.equal(latest?.contextUsedPercent, 2);
}

async function testCodexConfigSyncIdempotence() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-sync-'));
  const claudeDir = path.join(root, '.claude');
  const codexDir = path.join(root, '.codex');
  const claudeSettingsPath = path.join(claudeDir, 'settings.json');
  const configPath = path.join(codexDir, 'config.toml');

  try {
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      claudeSettingsPath,
      JSON.stringify(
        {
          mcpServers: {
            demo: {
              command: 'demo-cli',
              args: ['--flag'],
              env: { DEMO_KEY: 'value' },
            },
          },
        },
        null,
        2
      )
    );

    const firstStatus = await syncCodexConfig({ codexHome: codexDir, claudeSettingsPath });
    const firstConfig = await fs.readFile(configPath, 'utf8');
    assert.equal(firstConfig.startsWith('\n'), false);
    assert.match(firstConfig, /\[profiles\.fast\]/);
    assert.match(firstConfig, /model = "gpt-5\.5"/);
    assert.match(firstConfig, /service_tier = "fast"/);
    assert.match(firstConfig, /\[mcp_servers\.oracle\]/);
    assert.match(firstConfig, /command = "node"/);
    assert.match(firstConfig, /args = \["\/app\/scripts\/mcp-servers\/oracle\.mjs"\]/);
    assert.match(firstConfig, /ORACLE_HOME_DIR = "\/home\/node\/\.codex\/oracle"/);
    assert.match(firstConfig, /\[mcp_servers\.demo\]/);
    assert.match(firstConfig, /command = "demo-cli"/);
    assert.match(firstConfig, /DEMO_KEY = "value"/);

    const secondStatus = await syncCodexConfig({ codexHome: codexDir, claudeSettingsPath });
    const secondConfig = await fs.readFile(configPath, 'utf8');
    assert.equal(secondConfig.startsWith('\n'), false);
    assert.equal(firstConfig, secondConfig);
    assert.match(firstStatus, /updated|unchanged/);
    assert.match(secondStatus, /updated|unchanged/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testDefaultMcpServerSeeding() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-defaults-'));
  const settingsPath = path.join(root, '.claude', 'settings.json');

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          mcpServers: {
            godot: {
              type: 'stdio',
              command: 'custom-godot-wrapper',
              args: ['--keep-me'],
            },
          },
          env: { KEEP: '1' },
        },
        null,
        2
      )
    );

    const first = await ensureDefaultClaudeMcpServers({ settingsPath });
    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
      env?: Record<string, string>;
    };

    assert.deepEqual(first.added, ['blender']);
    assert.equal(parsed.mcpServers.godot.command, 'custom-godot-wrapper');
    assert.deepEqual(parsed.mcpServers.godot.args, ['--keep-me']);
    assert.equal(parsed.mcpServers.blender.command, 'node');
    assert.deepEqual(parsed.mcpServers.blender.args, ['/app/scripts/mcp-servers/blender.mjs']);
    assert.equal(parsed.env?.KEEP, '1');

    const second = await ensureDefaultClaudeMcpServers({ settingsPath });
    assert.equal(second.updated, false);
    assert.deepEqual(second.added, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function callMcpScript(
  scriptPath: string,
  request: Record<string, unknown>,
  env: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for MCP response from ${scriptPath}. stderr=${stderr}`)
        );
      }, 5_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n').filter((entry) => entry.trim())) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.id === request.id) {
            clearTimeout(timer);
            resolve(parsed);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`MCP script exited with ${code}. stderr=${stderr}`));
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  } finally {
    child.kill('SIGTERM');
  }
}

async function testGodotAndBlenderMcpToolLists() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const godotResponse = await callMcpScript(
    path.join(repoRoot, 'scripts/mcp-servers/godot.mjs'),
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { GODOT_BIN: '/definitely/missing/godot' }
  );
  const blenderResponse = await callMcpScript(
    path.join(repoRoot, 'scripts/mcp-servers/blender.mjs'),
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { BLENDER_BIN: '/definitely/missing/blender' }
  );

  const godotTools = (
    (godotResponse.result as { tools?: Array<{ name?: string }> })?.tools || []
  ).map((tool) => tool.name);
  const blenderTools = (
    (blenderResponse.result as { tools?: Array<{ name?: string }> })?.tools || []
  ).map((tool) => tool.name);

  assert.ok(godotTools.includes('godot_create_project'));
  assert.ok(godotTools.includes('godot_validate_project'));
  assert.ok(blenderTools.includes('blender_create_asset'));
  assert.ok(blenderTools.includes('blender_render_preview'));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function testOracleMcpPrefersEmbeddedBrowserTarget() {
  const runtimePayload = {
    success: true,
    data: {
      sessionId: 'session-1',
      userId: 'user-1',
      mode: 'profile',
      chatgptUrl: 'https://chatgpt.com/',
      remoteChrome: null,
      chromeProfile: null,
      chromeCookiePath: null,
      manualLoginProfileDir: null,
      embeddedRemoteChrome: '127.0.0.1:34865',
    },
  };
  const server = createServer((req, res) => {
    if (req.url === '/api/oracle/internal/runtime') {
      if (
        req.headers['x-webui-hook-secret'] !== 'test-secret' ||
        req.headers['x-webui-session-id'] !== 'session-1'
      ) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(runtimePayload));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false }));
  });
  const listenAddress = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test runtime server'));
        return;
      }
      resolve({ port: address.port });
    });
  });
  const oracleHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oracle-mcp-test-'));

  try {
    const oracleScript = path.join(repoRoot, 'scripts/mcp-servers/oracle.mjs');
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'consult',
        arguments: {
          prompt: 'Smoke test prompt',
          files: ['packages/backend/src/routes/oracle.ts'],
          engine: 'browser',
          slug: 'embedded-browser-args',
        },
      },
    };
    const readMcpResponse = async (
      child: ChildProcessWithoutNullStreams
    ): Promise<Record<string, unknown>> => {
      let stdout = '';
      let stderr = '';
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for Oracle MCP response. stderr=${stderr}`));
        }, 5_000);

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
          const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
          for (const line of lines) {
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (parsed.id === 1) {
              clearTimeout(timer);
              resolve(parsed);
            }
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('exit', (code) => {
          if (code && code !== 0) {
            clearTimeout(timer);
            reject(new Error(`Oracle MCP exited with ${code}. stderr=${stderr}`));
          }
        });

        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    };
    const assertConsultResponse = (response: Record<string, unknown>) => {
      const result = response.result as
        | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
        | undefined;
      const text = result?.content?.[0]?.text || '';

      assert.equal(result?.isError, undefined);
      assert.match(text, /--engine browser/);
      assert.match(text, /--browser-model-strategy current/);
      assert.match(text, /--browser-timeout 8m/);
      assert.match(text, /--remote-chrome 127\.0\.0\.1:34865/);
      assert.doesNotMatch(text, /--browser-thinking-time/);
      assert.doesNotMatch(text, /--browser-manual-login/);
      assert.doesNotMatch(text, /--browser-keep-browser/);
    };

    const child = spawn(process.execPath, [oracleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    assertConsultResponse(await readMcpResponse(child));

    child.kill('SIGTERM');

    const parentScript = `
      import { spawn } from 'node:child_process';

      const request = ${JSON.stringify(JSON.stringify(request))};
      const child = spawn(process.execPath, [process.env.ORACLE_SCRIPT], {
        cwd: process.env.REPO_ROOT,
        env: {
          HOME: process.env.HOME || '',
          PATH: process.env.PATH || '',
          ORACLE_BIN: process.env.ORACLE_BIN,
          ORACLE_HOME_DIR: process.env.ORACLE_HOME_DIR,
          ORACLE_MCP_TIMEOUT_MS: process.env.ORACLE_MCP_TIMEOUT_MS,
          ORACLE_BROWSER_MODEL_STRATEGY: process.env.ORACLE_BROWSER_MODEL_STRATEGY,
          ORACLE_BROWSER_THINKING_TIME: process.env.ORACLE_BROWSER_THINKING_TIME || '',
          npm_config_cache: process.env.npm_config_cache || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        console.error('Timed out waiting for nested Oracle MCP response. stderr=' + stderr);
        child.kill('SIGTERM');
        process.exit(1);
      }, 5000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\\n').filter((entry) => entry.trim())) {
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.id === 1) {
            clearTimeout(timer);
            console.log(JSON.stringify(parsed));
            child.kill('SIGTERM');
            process.exit(0);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          console.error('Nested Oracle MCP exited with ' + code + '. stderr=' + stderr);
          process.exit(1);
        }
      });
      child.stdin.write(request + '\\n');
    `;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', parentScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_SCRIPT: oracleScript,
        REPO_ROOT: repoRoot,
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    assertConsultResponse(await readMcpResponse(parent));
    parent.kill('SIGTERM');
  } finally {
    await closeServer(server);
    await fs.rm(oracleHome, { recursive: true, force: true });
  }
}

async function testOracleMcpStartsEmbeddedBrowserForManualMode() {
  let startCalled = false;
  const runtimePayload = {
    success: true,
    data: {
      sessionId: 'session-1',
      userId: 'user-1',
      mode: 'manual',
      chatgptUrl: 'https://chatgpt.com/',
      remoteChrome: null,
      chromeProfile: null,
      chromeCookiePath: null,
      manualLoginProfileDir: '/tmp/plum-oracle-profile',
      embeddedRemoteChrome: null,
    },
  };
  const server = createServer((req, res) => {
    const hasAuth =
      req.headers['x-webui-hook-secret'] === 'test-secret' &&
      req.headers['x-webui-session-id'] === 'session-1';

    if (req.url === '/api/oracle/internal/runtime') {
      if (!hasAuth) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(runtimePayload));
      return;
    }

    if (req.url === '/api/oracle/internal/browser/start' && req.method === 'POST') {
      startCalled = true;
      if (!hasAuth) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            embeddedRemoteChrome: '127.0.0.1:45678',
            profileDir: '/tmp/plum-oracle-profile',
            status: 'running',
            running: true,
          },
        })
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false }));
  });
  const listenAddress = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test runtime server'));
        return;
      }
      resolve({ port: address.port });
    });
  });
  const oracleHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oracle-mcp-manual-test-'));

  try {
    const oracleScript = path.join(repoRoot, 'scripts/mcp-servers/oracle.mjs');
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'consult',
        arguments: {
          prompt: 'Smoke test prompt',
          engine: 'browser',
          slug: 'manual-browser-start-args',
        },
      },
    };
    const child = spawn(process.execPath, [oracleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for Oracle MCP response. stderr=${stderr}`));
      }, 5_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n').filter((entry) => entry.trim())) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.id === 1) {
            clearTimeout(timer);
            resolve(parsed);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`Oracle MCP exited with ${code}. stderr=${stderr}`));
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`);
    });

    const result = response.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = result?.content?.[0]?.text || '';

    assert.equal(startCalled, true);
    assert.equal(result?.isError, undefined);
    assert.match(text, /--engine browser/);
    assert.match(text, /--browser-model-strategy current/);
    assert.match(text, /--browser-timeout 8m/);
    assert.match(text, /--remote-chrome 127\.0\.0\.1:45678/);
    assert.doesNotMatch(text, /--browser-thinking-time/);
    assert.doesNotMatch(text, /--browser-cookie-path/);
    child.kill('SIGTERM');
  } finally {
    await closeServer(server);
    await fs.rm(oracleHome, { recursive: true, force: true });
  }
}

function testPricingTable() {
  assert.deepEqual(resolveModelPricing('gpt-5.5')?.input, 5);
  assert.deepEqual(resolveModelPricing('gpt-5.4-mini')?.output, 4.5);
  assert.deepEqual(resolveModelPricing('gpt-5.2')?.input, 1.75);
  assert.deepEqual(resolveModelPricing('claude-opus-4-8')?.input, 5);
  assert.deepEqual(resolveModelPricing('claude-opus-4.7')?.output, 25);
  assert.deepEqual(resolveModelPricing('anthropic/claude-opus-4.5')?.cacheWrite, 6.25);
  assert.deepEqual(resolveModelPricing('claude-opus-4-1-20250805')?.input, 15);
  assert.deepEqual(resolveModelPricing('claude-opus-4.1')?.output, 75);
  assert.deepEqual(resolveModelPricing('claude-sonnet-4.6')?.cacheRead, 0.3);
  assert.deepEqual(resolveModelPricing('anthropic/claude-sonnet-4.5')?.output, 15);
  assert.deepEqual(resolveModelPricing('claude-haiku-4.5')?.cacheWrite, 1.25);
  assert.deepEqual(resolveModelPricing('claude-3.5-haiku-20241022')?.input, 0.8);
  assert.deepEqual(resolveModelPricing('z-ai/glm-5.2')?.output, 4.4);
  assert.deepEqual(resolveModelPricing('z-ai/glm-5.1')?.cacheRead, 0.26);
  assert.deepEqual(resolveModelPricing('glm-4.7')?.output, 2.2);
  assert.deepEqual(resolveModelPricing('opencode-go/kimi-k2.7-code')?.cacheRead, 0.19);
  assert.deepEqual(resolveModelPricing('opencode/kimi-k2.7-code')?.output, 4);
  assert.deepEqual(resolveModelPricing('deepseek/deepseek-v4-flash')?.cacheRead, 0.0028);
  assert.deepEqual(resolveModelPricing('deepseek/deepseek-v4-pro')?.output, 0.87);
  assert.deepEqual(resolveModelPricing('gemini-3.1-pro-preview')?.cacheRead, 0.2);
  assert.deepEqual(resolveModelPricing('mistral-vibe-cli-latest')?.output, 7.5);
  assert.deepEqual(resolveModelPricing('devstral-small-latest')?.input, 0.1);
  assert.deepEqual(resolveModelPricing('opencode/gpt-5.1')?.output, 8.5);
  assert.deepEqual(resolveModelPricing('opencode/qwen3.6-plus')?.cacheWrite, 0.625);
  assert.deepEqual(resolveModelPricing('opencode/deepseek-v4-flash')?.cacheRead, 0.03);
  assert.deepEqual(resolveModelPricing('opencode/big-pickle')?.input, 0);
  assert.deepEqual(resolveModelPricing('opencode-go/glm-5.1')?.input, 1.4);
  assert.equal(resolveModelPricing('ollama-cloud/devstral-small-2:24b'), null);

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

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const buffer = await fs.readFile(filePath);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47);
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function testPwaInstallAssets() {
  const publicDir = path.join(repoRoot, 'packages/frontend/public');
  const indexHtml = await fs.readFile(path.join(repoRoot, 'packages/frontend/index.html'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(publicDir, 'manifest.json'), 'utf8')) as {
    start_url?: string;
    scope?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
  };

  assert.match(
    indexHtml,
    /<link\s+rel="manifest"\s+href="\/manifest\.json"\s+crossorigin="use-credentials"\s*\/?>/,
    'auth-gated deployments need manifest credentials so Chrome can fetch manifest.json'
  );

  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');

  const expectedIcons = new Map([
    ['192x192', { width: 192, height: 192 }],
    ['512x512', { width: 512, height: 512 }],
  ]);

  for (const [size, expected] of expectedIcons) {
    const icon = manifest.icons?.find((candidate) => candidate.sizes === size);
    assert.ok(icon, `missing PWA icon ${size}`);
    assert.equal(icon.type, 'image/png');
    assert.match(icon.purpose || '', /maskable/);
    assert.ok(icon.src?.startsWith('/logos/'));

    const dimensions = await readPngDimensions(path.join(publicDir, icon.src.slice(1)));
    assert.deepEqual(dimensions, expected);
  }

  const serviceWorker = await fs.readFile(path.join(publicDir, 'sw.js'), 'utf8');
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/);
  assert.match(serviceWorker, /self\.clients\.claim/);
  assert.doesNotMatch(serviceWorker, /unregister/);

  const legacyServiceWorker = await fs.readFile(path.join(publicDir, 'service-worker.js'), 'utf8');
  assert.match(legacyServiceWorker, /importScripts\('\/sw\.js'\)/);
}

testProviderLabels();
testContextWindowFallbacks();
testUsageWindowNormalization();
testContextUsageIncludesAssistantOutput();
testCodexUsageUsesNormalizedContextWindow();
testContextUsageCapsAtWindow();
testCodexFreshExecUsageDoesNotDelta();
await testCodexThreadStateReaderMatchesPrompt();
await testCodexContextSnapshotReadsRolloutTokenCount();
await testCodexContextFallbackUsesThreadState();
await testCodexContextFallbackCapsThreadStateAtWindow();
testCodexCompactEventRetainsCompactedContext();
testCodexImplicitCompactDetectedFromContextDrop();
testCodexImplicitCompactDetectedFromMidWindowReset();
testProviderCapabilities();
testCodexFastTierArgs();
testOpenCodeConfiguredModelAllowList();
testOpenCodeZaiCredentialAliases();
testOpenCodeWebuiProviderConfig();
testOpenCodeSessionModelSelection();
testOpenCodeAllowedDirectories();
testAttachmentNormalization();
testOpenCodePromptContext();
testOpenCodeRuntimePrompt();
testOpenCodePrimaryAgentConfig();
testOpenCodeModelsCacheParsing();
testOpenCodeFallbackCatalogIncludesKimiK27();
testZaiUsageTrackerQuotaShape();
testOpenCodeGoMonitorHtmlShape();
testOpenCodeGoLocalEstimateRequiresUsage();
testOpenCodeTerminalMessageDetection();
testOpenCodePollCursorPriming();
testProxyUserAdoptsLegacySharedCliUser();
testCodexSessionIdExtraction();
testDisconnectedSessionStaysRunning();
testOpenCodeQueueStateAndRuntime();
testLatestContextSnapshotOrdering();
await testCodexConfigSyncIdempotence();
await testDefaultMcpServerSeeding();
await testGodotAndBlenderMcpToolLists();
await testOracleMcpPrefersEmbeddedBrowserTarget();
await testOracleMcpStartsEmbeddedBrowserForManualMode();
await testPwaInstallAssets();
testPricingTable();

console.log('provider regression tests passed');
