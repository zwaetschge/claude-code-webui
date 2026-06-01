export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  source: string;
  label: string;
}

export interface UsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ModelCostEstimate {
  cost: number;
  pricing: ModelPricing | null;
  known: boolean;
}

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  input: 5,
  output: 30,
  cacheRead: 0.5,
  cacheWrite: 0,
  source: 'OpenAI API pricing, 2026-06-01',
  label: 'GPT-5.5 fallback',
};

function stripProviderPrefix(model: string): string {
  const slash = model.indexOf('/');
  if (slash === -1) return model;
  const provider = model.slice(0, slash);
  const id = model.slice(slash + 1);
  if (provider === 'anthropic' || provider === 'openai' || provider === 'mistral') {
    return id;
  }
  return model;
}

function price(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  source: string,
  label: string
): ModelPricing {
  return { input, output, cacheRead, cacheWrite, source, label };
}

export function resolveModelPricing(model?: string | null): ModelPricing | null {
  if (!model) return null;
  const raw = model.trim().toLowerCase();
  if (!raw) return null;
  const id = stripProviderPrefix(raw);

  // OpenAI, USD per 1M tokens.
  if (id.startsWith('gpt-5.5')) {
    return price(5, 30, 0.5, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.5');
  }
  if (id.startsWith('gpt-5.4-mini')) {
    return price(0.75, 4.5, 0.075, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.4 mini');
  }
  if (id.startsWith('gpt-5.4')) {
    return price(2.5, 15, 0.25, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.4');
  }
  if (id.startsWith('gpt-5.3-codex') || id.startsWith('gpt-5.2-codex')) {
    return price(1.75, 14, 0.175, 0, 'OpenAI model pricing, 2026-06-01', 'GPT Codex');
  }
  if (id === 'gpt-5' || id.startsWith('gpt-5.2')) {
    return price(1.25, 10, 0.125, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5 family');
  }
  if (id.startsWith('gpt-4o-mini')) {
    return price(0.15, 0.6, 0.075, 0, 'OpenAI model pricing, 2026-06-01', 'GPT-4o mini');
  }
  if (id.startsWith('gpt-4o')) {
    return price(2.5, 10, 1.25, 0, 'OpenAI model pricing, 2026-06-01', 'GPT-4o');
  }

  // Anthropic, USD per 1M tokens. Cache write uses the 5 minute write rate.
  if (/^claude-opus-4-(5|6|7|8)/.test(id) || id === 'opus') {
    return price(5, 25, 0.5, 6.25, 'Anthropic API pricing, 2026-06-01', 'Claude Opus 4.5+');
  }
  if (/^claude-opus-4($|-202|-0|-1)/.test(id)) {
    return price(15, 75, 1.5, 18.75, 'Anthropic API pricing, 2026-06-01', 'Claude Opus 4/4.1');
  }
  if (/^claude-sonnet-4/.test(id) || id === 'sonnet') {
    return price(3, 15, 0.3, 3.75, 'Anthropic API pricing, 2026-06-01', 'Claude Sonnet 4');
  }
  if (/^claude-3-5-sonnet/.test(id)) {
    return price(3, 15, 0.3, 3.75, 'Anthropic API pricing, 2026-06-01', 'Claude Sonnet 3.5');
  }
  if (/^claude-haiku-4-5/.test(id) || id === 'haiku') {
    return price(1, 5, 0.1, 1.25, 'Anthropic API pricing, 2026-06-01', 'Claude Haiku 4.5');
  }
  if (/^claude-3-5-haiku/.test(id)) {
    return price(0.8, 4, 0.08, 1, 'Anthropic API pricing, 2026-06-01', 'Claude Haiku 3.5');
  }

  // Z.AI, USD per 1M tokens.
  if (raw === 'z-ai/glm-5.1' || raw === 'zai/glm-5.1' || id === 'glm-5.1') {
    return price(1.4, 4.4, 0.26, 0, 'Z.AI pricing, 2026-06-01', 'GLM-5.1');
  }
  if (raw === 'z-ai/glm-5' || raw === 'zai/glm-5' || id === 'glm-5') {
    return price(1, 3.2, 0.2, 0, 'Z.AI pricing, 2026-06-01', 'GLM-5');
  }

  // Mistral, USD per 1M tokens. The public table does not expose prompt-cache
  // discounts for these text models, so cached tokens are priced as normal input.
  if (
    id === 'mistral-vibe-cli-latest' ||
    id === 'mistral-medium-3.5' ||
    id === 'mistral-medium-latest'
  ) {
    return price(1.5, 7.5, 1.5, 1.5, 'Mistral API pricing, 2026-06-01', 'Mistral Medium 3.5');
  }
  if (id === 'devstral-small-latest' || id.includes('devstral-small')) {
    return price(0.1, 0.3, 0.1, 0.1, 'Mistral API pricing, 2026-06-01', 'Devstral Small 2');
  }
  if (id === 'devstral-medium-latest' || id.includes('devstral-medium')) {
    return price(0.4, 2, 0.4, 0.4, 'Mistral API pricing, 2026-06-01', 'Devstral 2');
  }
  if (id === 'codestral-latest') {
    return price(0.3, 0.9, 0.3, 0.3, 'Mistral API pricing, 2026-06-01', 'Codestral');
  }
  if (id === 'mistral-small-latest') {
    return price(0.1, 0.3, 0.1, 0.1, 'Mistral API pricing, 2026-06-01', 'Mistral Small 4');
  }
  if (id === 'mistral-large-latest') {
    return price(0.5, 1.5, 0.5, 0.5, 'Mistral API pricing, 2026-06-01', 'Mistral Large 3');
  }

  return null;
}

export function calculateModelCost(tokens: UsageTokenCounts, pricing: ModelPricing): number {
  return (
    (tokens.inputTokens / 1_000_000) * pricing.input +
    (tokens.outputTokens / 1_000_000) * pricing.output +
    (tokens.cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (tokens.cacheCreationTokens / 1_000_000) * pricing.cacheWrite
  );
}

export function estimateModelCost(
  model: string | null | undefined,
  tokens: UsageTokenCounts,
  fallbackPricing: ModelPricing | null = DEFAULT_MODEL_PRICING
): ModelCostEstimate {
  const pricing = resolveModelPricing(model);
  const effectivePricing = pricing ?? fallbackPricing;
  return {
    cost: effectivePricing ? calculateModelCost(tokens, effectivePricing) : 0,
    pricing: effectivePricing,
    known: !!pricing,
  };
}
