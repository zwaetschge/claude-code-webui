import assert from 'node:assert/strict';
import type { Theme } from '@plum-code-webui/shared';
import {
  applyTheme,
  getStoredTheme,
  normalizeTheme,
  setStoredTheme,
} from '../src/stores/appearanceStore.ts';

function createClassList() {
  const classes = new Set<string>();
  return {
    add: (...values: string[]) => {
      values.forEach((value) => classes.add(value));
    },
    remove: (...values: string[]) => {
      values.forEach((value) => classes.delete(value));
    },
    contains: (value: string) => classes.has(value),
    values: () => Array.from(classes).sort(),
  };
}

function installLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
  globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
}

function testEinkThemeNormalizesAndAppliesAsStaticMode(): void {
  const classList = createClassList();
  globalThis.document = {
    documentElement: {
      classList,
      dataset: {},
    },
  } as unknown as Document;

  assert.equal(normalizeTheme('eink'), 'eink');

  applyTheme('eink' as Theme);
  assert.deepEqual(classList.values(), ['eink']);
  assert.equal(classList.contains('dark'), false);
  assert.equal(classList.contains('light'), false);

  applyTheme('light');
  assert.deepEqual(classList.values(), ['light']);
  assert.equal(classList.contains('eink'), false);
}

function testThemePersistsInDeviceStorage(): void {
  installLocalStorage();

  setStoredTheme('eink');
  assert.equal(getStoredTheme(), 'eink');

  setStoredTheme('not-a-theme');
  assert.equal(getStoredTheme(), 'dark');
}

testEinkThemeNormalizesAndAppliesAsStaticMode();
testThemePersistsInDeviceStorage();
console.log('appearance theme tests passed');
