import type { CLIProvider as CLIProviderType } from '@claude-code-webui/shared';
export type { CLIProvider } from '@claude-code-webui/shared';
type CLIProvider = CLIProviderType;

export type UiProvider = 'plum' | 'claude' | 'codex' | 'opencode' | 'vibe';

export const DEFAULT_UI_PROVIDER: UiProvider = 'plum';
export const UI_PROVIDER_STORAGE_KEY = 'ui-provider';

export const UI_PROVIDER_META: Record<
  UiProvider,
  {
    id: UiProvider;
    label: string;
    productName: string;
    tagline: string;
    loginCta: string;
    description: string;
  }
> = {
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
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    productName: 'OpenCode',
    tagline: 'Multi-Provider',
    loginCta: 'Continue with OpenCode',
    description: 'OpenCode CLI with 75+ LLM providers. Default: GLM 5.1.',
  },
  vibe: {
    id: 'vibe',
    label: 'Vibe',
    productName: 'Mistral Vibe',
    tagline: 'Mistral',
    loginCta: 'Continue with Mistral Vibe',
    description: 'Mistral Vibe CLI with Devstral/Codestral coding models.',
  },
};

export const CLI_PROVIDER_LABEL: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  vibe: 'Mistral Vibe',
};

export const CLI_PROVIDER_ICON: Record<CLIProvider, string> = {
  claude: 'C',
  codex: 'O',
  opencode: '⚡',
  vibe: 'M',
};

export const CLI_PROVIDER_DEFAULT_MODEL: Record<CLIProvider, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.5',
  opencode: 'z-ai/glm-5.1',
  vibe: 'mistral-vibe-cli-latest',
};

export const UI_PROVIDER_THEME_COLOR: Record<UiProvider, string> = {
  plum: '#6d2a88',
  claude: '#141413',
  codex: '#000000',
  opencode: '#160d2b',
  vibe: '#1e1e1e',
};

export const CLI_PROVIDER_LIMIT_LABELS: Record<
  CLIProvider,
  {
    session: { title: string; subtitle?: string };
    weeklyAll?: { title: string; subtitle?: string };
    weeklySonnet?: { title: string; subtitle?: string };
  }
> = {
  claude: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'All' },
    weeklySonnet: { title: 'Weekly', subtitle: 'Sonnet' },
  },
  codex: {
    // Codex limits come from /backend-api/codex/usage:
    //   primary_window  → 5h "session" budget
    //   secondary_window → 7d weekly budget
    // Codex has no per-model split (no Sonnet equivalent) — the sevenDaySonnet
    // field is intentionally null and the third bar is hidden.
    session: { title: '5h', subtitle: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'Total' },
  },
  opencode: {
    session: { title: '24h', subtitle: 'Local' },
    weeklyAll: { title: 'Weekly', subtitle: 'Local' },
  },
  vibe: {
    session: { title: '24h', subtitle: 'Local' },
    weeklyAll: { title: 'Weekly', subtitle: 'Local' },
  },
};

const CLI_TO_UI: Record<CLIProvider, UiProvider> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  vibe: 'vibe',
};

const UI_TO_CLI: Record<UiProvider, CLIProvider> = {
  plum: 'codex',
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  vibe: 'vibe',
};

export function normalizeUiProvider(value?: string | null): UiProvider {
  const key = (value || '').toLowerCase();
  if (key === 'plum') return 'plum';
  if (key === 'codex') return 'codex';
  if (key === 'opencode') return 'opencode';
  if (key === 'vibe') return 'vibe';
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
  root.classList.remove(
    'provider-plum',
    'provider-claude',
    'provider-codex',
    'provider-opencode',
    'provider-vibe'
  );
  root.classList.add(`provider-${provider}`);
  root.setAttribute('data-provider', provider);

  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.content = UI_PROVIDER_THEME_COLOR[provider];
  }

  const tileMeta = document.querySelector<HTMLMetaElement>('meta[name="msapplication-TileColor"]');
  if (tileMeta) {
    tileMeta.content = UI_PROVIDER_THEME_COLOR[provider];
  }
}
