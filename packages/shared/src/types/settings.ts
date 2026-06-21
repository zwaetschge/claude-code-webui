import type { CLIProvider, CodexServiceTier } from './session.js';

export type Theme = 'dark' | 'light' | 'system';
export type UiProvider = 'plum' | 'claude' | 'codex' | 'opencode' | 'vibe';
export type BackgroundAnimation = 'glass' | 'aurora' | 'ribbons' | 'still';
export type CodexWebSearchMode = 'auto' | 'cached' | 'live' | 'disabled';
export type OracleBrowserMode = 'profile' | 'manual' | 'remote';

export interface LocalUsageBudget {
  dailyUsd?: number;
  weeklyUsd?: number;
}

export interface OracleBrowserSettings {
  mode?: OracleBrowserMode;
  chatgptUrl?: string;
  remoteChrome?: string;
  chromeProfile?: string;
  chromeCookiePath?: string;
  manualLoginProfileDir?: string;
}

export interface UserSettings {
  userId: string;
  theme: Theme;
  defaultWorkingDir: string | null;
  allowedTools: string[];
  customSystemPrompt: string | null;
  uiProvider?: UiProvider;
  backgroundAnimation?: BackgroundAnimation;
  defaultCliProvider?: CLIProvider;
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
  localUsageBudgets?: Partial<Record<CLIProvider, LocalUsageBudget>>;
  oracleBrowser?: OracleBrowserSettings;
}

export interface UpdateSettingsInput {
  theme?: Theme;
  defaultWorkingDir?: string | null;
  allowedTools?: string[];
  customSystemPrompt?: string | null;
  uiProvider?: UiProvider;
  backgroundAnimation?: BackgroundAnimation;
  defaultCliProvider?: CLIProvider;
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
  localUsageBudgets?: Partial<Record<CLIProvider, LocalUsageBudget>>;
  oracleBrowser?: OracleBrowserSettings;
}

export interface ClaudeSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
