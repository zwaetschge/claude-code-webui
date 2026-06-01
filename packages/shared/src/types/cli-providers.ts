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

export type ProviderFamilyLabel = 'Codex' | 'Claude' | 'OpenCode' | 'Vibe' | 'Other';

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
