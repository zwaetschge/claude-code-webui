import type { CLIProvider } from './session';

export type Theme = 'dark' | 'light' | 'system';
export type UiProvider = 'plum' | 'claude' | 'codex' | 'opencode' | 'vibe';
export type CodexWebSearchMode = 'auto' | 'cached' | 'live' | 'disabled';
export type CodexServiceTier = 'fast';

export interface UserSettings {
  userId: string;
  theme: Theme;
  defaultWorkingDir: string | null;
  allowedTools: string[];
  customSystemPrompt: string | null;
  uiProvider?: UiProvider;
  defaultCliProvider?: CLIProvider;
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
}

export interface UpdateSettingsInput {
  theme?: Theme;
  defaultWorkingDir?: string | null;
  allowedTools?: string[];
  customSystemPrompt?: string | null;
  uiProvider?: UiProvider;
  defaultCliProvider?: CLIProvider;
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
}

export interface ClaudeSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
