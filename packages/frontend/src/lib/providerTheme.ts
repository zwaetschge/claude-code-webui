export type UiProvider = 'claude' | 'zai' | 'codex';

const STORAGE_KEY = 'uiProvider';

export const PROVIDER_OPTIONS: Array<{ id: UiProvider; label: string; description: string }> = [
  { id: 'claude', label: 'Claude', description: 'Warm Claude-inspired palette' },
  { id: 'zai', label: 'Z.AI', description: 'Plum-accented Z.AI look' },
  { id: 'codex', label: 'Codex', description: 'OpenAI-inspired styling' },
];

export function getStoredProvider(): UiProvider {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'zai' || stored === 'codex' || stored === 'claude') {
    return stored;
  }
  return 'claude';
}

export function setProviderTheme(provider: UiProvider) {
  document.documentElement.dataset.provider = provider;
  localStorage.setItem(STORAGE_KEY, provider);
}

export function getProviderLabel(provider: UiProvider): string {
  return PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? provider;
}
