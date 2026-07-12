import type { UsageSnapshot } from '../types/session.js';

export const DEFAULT_CONTEXT_WINDOW = 200_000;

export function resolveContextWindow(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;

  const id = model.toLowerCase();

  // Anthropic's current 4.x/5.x Claude families use the 1M-token window.
  if (id === 'opus' || id === 'sonnet' || id === 'haiku') return 1_000_000;
  if (/(opus|sonnet|haiku)-?(4|5)/.test(id)) return 1_000_000;

  // Codex / GPT-5.x windows observed in live session logs.
  if (id.startsWith('gpt-5.6')) return 1_050_000;
  if (id.startsWith('gpt-5.4-mini')) return 128_000;
  if (id.startsWith('gpt-5.4')) return 196_000;
  if (id.startsWith('gpt-5.3-codex')) return 400_000;
  if (id.startsWith('gpt-5.5')) return 256_000;
  if (id.startsWith('gpt-5')) return 256_000;

  return DEFAULT_CONTEXT_WINDOW;
}

export function normalizeUsageSnapshot(
  usage: UsageSnapshot | null | undefined
): UsageSnapshot | undefined {
  if (!usage) return undefined;

  const resolvedWindow = resolveContextWindow(usage.model);
  const contextWindow =
    resolvedWindow !== DEFAULT_CONTEXT_WINDOW && resolvedWindow !== usage.contextWindow
      ? resolvedWindow
      : usage.contextWindow;
  const totalTokens =
    contextWindow > 0 ? Math.min(usage.totalTokens, contextWindow) : usage.totalTokens;
  const rawPercent =
    contextWindow > 0 && totalTokens > 0 ? Math.round((totalTokens * 100.0) / contextWindow) : 0;
  const normalized = {
    ...usage,
    totalTokens,
    contextWindow,
    contextUsedPercent: Math.max(0, Math.min(100, rawPercent)),
    contextUsedPercentRaw: Math.max(0, Math.min(100, rawPercent)),
    contextExceeded: false,
  };

  // Keep caller-provided windows for unknown models, but always preserve the
  // active-context invariant: display values cannot exceed their own window.
  if (resolvedWindow === DEFAULT_CONTEXT_WINDOW || resolvedWindow === usage.contextWindow) {
    return normalized;
  }

  return normalized;
}
