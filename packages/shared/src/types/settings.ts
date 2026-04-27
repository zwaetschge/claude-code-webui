import type { CLIProvider } from './session';

export type Theme = 'dark' | 'light' | 'system';
export type UiProvider = 'plum' | 'claude' | 'codex' | 'opencode';

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
}

export interface ClaudeSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
