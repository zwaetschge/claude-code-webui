import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI framework (Radix UI components)
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-scroll-area',
          ],
          // Monaco editor (largest dependency)
          'vendor-monaco': ['@monaco-editor/react'],
          // Data fetching and state management
          'vendor-data': ['@tanstack/react-query', 'zustand', 'socket.io-client'],
          // Markdown and syntax highlighting
          'vendor-markdown': ['react-markdown', 'react-syntax-highlighter'],
          // Math rendering (KaTeX)
          'vendor-katex': ['katex', 'remark-math', 'rehype-katex'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      // Only proxy backend auth routes, not /auth/callback (frontend route)
      '/auth/github': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/google': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/claude': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/me': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/logout': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/providers': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3006',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
