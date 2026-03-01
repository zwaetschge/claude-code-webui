import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: 'src/main/index.ts',
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: 'src/preload/preload.ts',
      },
    },
  },
  renderer: {
    // We don't use a local renderer — the app loads the remote WebUI URL
    build: {
      outDir: 'dist/renderer',
    },
  },
});
