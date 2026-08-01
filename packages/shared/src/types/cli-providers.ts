import type { CLIProvider } from './session.js';

export interface ProviderCapabilities {
  streaming: boolean;
  resume: boolean;
  modes: boolean;
  approvals: boolean;
  nativeVision: boolean;
  imageBridge: boolean;
  mcp: boolean;
  mcpSessionAttribution: 'native' | 'prompt-scoped' | 'none';
  usageLimits: 'upstream' | 'local-budget' | 'none';
  reasoning: boolean;
  serviceTier: boolean;
  webSearch: boolean;
  allowedDirectories: boolean;
}

export type ProviderFamilyLabel =
  | 'Codex'
  | 'Claude'
  | 'Z.AI'
  | 'Kimi'
  | 'OpenCode'
  | 'Pi'
  | 'Vibe'
  | 'Other';

export interface CliProviderUpdateResult {
  provider: CLIProvider;
  command: string;
  output: string;
  exitCode: number | null;
  status: 'updated' | 'failed';
}

export interface CliProviderUpdateResponse {
  results: CliProviderUpdateResult[];
}

export function getProviderLabelForModel(model?: string | null): ProviderFamilyLabel {
  const value = (model || '').toLowerCase();
  if (!value) return 'Other';
  if (value.startsWith('gpt-') || value.includes('codex')) return 'Codex';
  if (value.startsWith('claude') || value === 'opus' || value === 'sonnet' || value === 'haiku') {
    return 'Claude';
  }
  if (value.startsWith('mistral-') || value.startsWith('devstral-')) return 'Vibe';
  if (value.startsWith('glm-') || value.startsWith('z-ai/') || value.startsWith('zai/')) {
    return 'OpenCode';
  }
  if (value.includes('/') || value.includes('opencode')) return 'OpenCode';
  return 'Other';
}

/**
 * Resolve the analytics provider from the persisted runtime attribution first.
 *
 * Model-only inference remains available for historical rows, but it cannot
 * distinguish Pi from OpenCode because both harnesses can run the same routed
 * model id (for example `z-ai/glm-5.1`). New usage rows therefore persist the
 * CLI provider that actually executed the turn and consumers must prefer it.
 */
export function getProviderLabelForUsage(
  provider?: string | null,
  model?: string | null
): ProviderFamilyLabel {
  switch ((provider || '').trim().toLowerCase()) {
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude';
    case 'zai':
    case 'z-ai':
      return 'Z.AI';
    case 'kimi':
      return 'Kimi';
    case 'opencode':
      return 'OpenCode';
    case 'pi':
      return 'Pi';
    case 'vibe':
      return 'Vibe';
    default:
      return getProviderLabelForModel(model);
  }
}

/** Collision-free key for timeline series where two harnesses use one model id. */
export function getUsageModelKey(provider?: string | null, model?: string | null): string {
  return `${getProviderLabelForUsage(provider, model)}\u001f${model || 'Unknown'}`;
}
