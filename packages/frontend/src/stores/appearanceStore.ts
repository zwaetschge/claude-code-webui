import { create } from 'zustand';
import type { BackgroundAnimation, Theme } from '@plum-code-webui/shared';

export const DEFAULT_BACKGROUND_ANIMATION: BackgroundAnimation = 'aurora';
export const THEME_STORAGE_KEY = 'theme';
export const BACKGROUND_ANIMATION_STORAGE_KEY = 'background-animation';

export const BACKGROUND_ANIMATION_OPTIONS: Array<{
  value: BackgroundAnimation;
  label: string;
  description: string;
}> = [
  {
    value: 'aurora',
    label: 'Plum Waves',
    description: 'The original animated wave background',
  },
  {
    value: 'glass',
    label: 'Misty Waterdrops',
    description: 'Soft droplets on fogged glass',
  },
  {
    value: 'ribbons',
    label: 'Neon Glow',
    description: 'Glowing orbs with soft neon light',
  },
  {
    value: 'still',
    label: 'Aurora Galaxy',
    description: 'Slow starfield aurora drift',
  },
];

export function normalizeBackgroundAnimation(value: unknown): BackgroundAnimation {
  return value === 'aurora' || value === 'ribbons' || value === 'still' || value === 'glass'
    ? value
    : DEFAULT_BACKGROUND_ANIMATION;
}

export function normalizeTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' || value === 'system' || value === 'eink'
    ? value
    : 'dark';
}

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function setStoredTheme(theme: unknown): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const next = normalizeTheme(theme);
  const resolved = next === 'system' ? resolveSystemTheme() : next;
  const root = document.documentElement;

  root.classList.remove('light', 'dark', 'eink');
  root.classList.add(resolved);
  root.dataset.theme = next;
  root.dataset.resolvedTheme = resolved;
}

export function getStoredBackgroundAnimation(): BackgroundAnimation {
  if (typeof window === 'undefined') return DEFAULT_BACKGROUND_ANIMATION;
  return normalizeBackgroundAnimation(
    window.localStorage.getItem(BACKGROUND_ANIMATION_STORAGE_KEY)
  );
}

export function applyBackgroundAnimation(animation: BackgroundAnimation): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.backgroundAnimation = animation;
}

export function setStoredBackgroundAnimation(animation: BackgroundAnimation): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKGROUND_ANIMATION_STORAGE_KEY, animation);
}

interface AppearanceState {
  backgroundAnimation: BackgroundAnimation;
  setBackgroundAnimation: (animation: BackgroundAnimation) => void;
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  backgroundAnimation: getStoredBackgroundAnimation(),
  setBackgroundAnimation: (animation) => {
    const next = normalizeBackgroundAnimation(animation);
    setStoredBackgroundAnimation(next);
    applyBackgroundAnimation(next);
    set({ backgroundAnimation: next });
  },
}));
