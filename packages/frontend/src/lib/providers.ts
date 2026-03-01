import type { CLIProvider as CLIProviderType } from '@claude-code-webui/shared';
export type { CLIProvider } from '@claude-code-webui/shared';
type CLIProvider = CLIProviderType;

export type UiProvider = 'plum' | 'claude' | 'codex' | 'zai' | 'gemini' | 'kimi' | 'multi';

export const DEFAULT_UI_PROVIDER: UiProvider = 'plum';
export const UI_PROVIDER_STORAGE_KEY = 'ui-provider';

export const UI_PROVIDER_META: Record<UiProvider, {
  id: UiProvider;
  label: string;
  productName: string;
  tagline: string;
  loginCta: string;
  description: string;
}> = {
  plum: {
    id: 'plum',
    label: 'Plum',
    productName: 'Plum Code',
    tagline: 'WebUI',
    loginCta: 'Continue to Plum',
    description: 'A Plum-branded dashboard for multi-provider CLI sessions.',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    productName: 'Claude Code',
    tagline: 'WebUI',
    loginCta: 'Continue with Claude',
    description: 'Built for Anthropic Claude Code CLI workflows.',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    productName: 'Codex',
    tagline: 'WebUI',
    loginCta: 'Continue with Codex',
    description: 'OpenAI Codex CLI with fast, focused coding sessions.',
  },
  zai: {
    id: 'zai',
    label: 'Z.AI',
    productName: 'Z.AI',
    tagline: 'WebUI',
    loginCta: 'Continue with Z.AI',
    description: 'GLM models with Claude-style skills and planning.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    productName: 'Gemini CLI',
    tagline: 'WebUI',
    loginCta: 'Continue with Gemini',
    description: 'Google Gemini CLI for rapid multi-modal sessions.',
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi',
    productName: 'Kimi Code',
    tagline: 'WebUI',
    loginCta: 'Continue with Kimi',
    description: 'Moonshot AI Kimi CLI with multimodal coding and deep reasoning.',
  },
  multi: {
    id: 'multi',
    label: 'Multi-CLI',
    productName: 'Multi-CLI',
    tagline: 'Orchestrated',
    loginCta: 'Continue with Multi-CLI',
    description: 'Orchestrated multi-agent sessions with master/slave CLI collaboration.',
  },
};

export const CLI_PROVIDER_LABEL: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  glm: 'Z.AI',
  kimi: 'Kimi',
  multi: 'Multi-CLI',
};

export const CLI_PROVIDER_ICON: Record<CLIProvider, string> = {
  claude: 'C',
  codex: 'O',
  gemini: 'G',
  glm: 'Z',
  kimi: 'K',
  multi: '🎭',
};

export const CLI_PROVIDER_DEFAULT_MODEL: Record<CLIProvider, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.2-codex',
  gemini: 'auto',
  glm: 'glm-4.7',
  kimi: 'kimi-for-coding',
  multi: 'orchestrated',
};


export const CLI_PROVIDER_LIMIT_LABELS: Record<CLIProvider, {
  session: { title: string; subtitle?: string };
  weeklyAll?: { title: string; subtitle?: string };
  weeklySonnet?: { title: string; subtitle?: string };
}> = {
  claude: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'All' },
    weeklySonnet: { title: 'Weekly', subtitle: 'Sonnet' },
  },
  codex: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'All' },
    weeklySonnet: { title: 'Weekly', subtitle: 'Sonnet' },
  },
  gemini: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'All' },
    weeklySonnet: { title: 'Weekly', subtitle: 'Sonnet' },
  },
  glm: {
    session: { title: '5h Tokens' },
    weeklyAll: { title: 'MCP', subtitle: 'Monthly' },
  },
  kimi: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Daily', subtitle: 'All' },
  },
  multi: {
    session: { title: 'Agents' },
    weeklyAll: { title: 'Master' },
    weeklySonnet: { title: 'Slaves' },
  },
};

const CLI_TO_UI: Record<CLIProvider, UiProvider> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  glm: 'zai',
  kimi: 'kimi',
  multi: 'multi',
};

const UI_TO_CLI: Record<UiProvider, CLIProvider> = {
  plum: 'claude',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  zai: 'glm',
  kimi: 'kimi',
  multi: 'multi',
};

export function normalizeUiProvider(value?: string | null): UiProvider {
  const key = (value || '').toLowerCase();
  if (key === 'plum') return 'plum';
  if (key === 'zai' || key === 'z.ai') return 'zai';
  if (key === 'codex') return 'codex';
  if (key === 'gemini') return 'gemini';
  if (key === 'kimi') return 'kimi';
  if (key === 'multi' || key === 'multi-cli') return 'multi';
  return 'plum';
}

export function toUiProvider(cliProvider?: CLIProvider | null): UiProvider {
  if (!cliProvider) return DEFAULT_UI_PROVIDER;
  return CLI_TO_UI[cliProvider] || DEFAULT_UI_PROVIDER;
}

export function toCliProvider(uiProvider?: UiProvider | null): CLIProvider {
  if (!uiProvider) return UI_TO_CLI[DEFAULT_UI_PROVIDER];
  return UI_TO_CLI[uiProvider] || UI_TO_CLI[DEFAULT_UI_PROVIDER];
}

export function getStoredUiProvider(): UiProvider {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PROVIDER;
  }
  return normalizeUiProvider(window.localStorage.getItem(UI_PROVIDER_STORAGE_KEY));
}

export function setStoredUiProvider(provider: UiProvider): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(UI_PROVIDER_STORAGE_KEY, provider);
}

export function applyProviderClass(provider: UiProvider): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.classList.remove('provider-plum', 'provider-claude', 'provider-codex', 'provider-zai', 'provider-gemini', 'provider-kimi', 'provider-multi');
  // Multi-CLI uses plum theme
  const themeClass = provider === 'multi' ? 'provider-plum' : `provider-${provider}`;
  root.classList.add(themeClass);
  root.setAttribute('data-provider', provider);
}
