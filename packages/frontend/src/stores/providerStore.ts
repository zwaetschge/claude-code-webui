import { create } from 'zustand';
import {
  applyProviderClass,
  DEFAULT_UI_PROVIDER,
  getStoredUiProvider,
  setStoredUiProvider,
  type UiProvider,
} from '@/lib/providers';

interface ProviderState {
  uiProvider: UiProvider;
  setProvider: (provider: UiProvider) => void;
}

export const useProviderStore = create<ProviderState>((set) => ({
  uiProvider: getStoredUiProvider(),
  setProvider: (provider) => {
    setStoredUiProvider(provider);
    applyProviderClass(provider);
    set({ uiProvider: DEFAULT_UI_PROVIDER });
  },
}));
