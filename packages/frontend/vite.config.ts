import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const backendPort = process.env.BACKEND_PORT || '3006';
const backendUrl = `http://localhost:${backendPort}`;
const serverPort = parseInt(process.env.VITE_PORT || '5173', 10);
const serverHost = process.env.VITE_HOST || 'localhost';

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
            '@radix-ui/react-scroll-area',
          ],
          // Data fetching and state management
          'vendor-data': ['@tanstack/react-query', 'zustand', 'socket.io-client'],
          // Markdown rendering
          'vendor-markdown': ['react-markdown'],
          // Math rendering (KaTeX)
          'vendor-katex': ['katex', 'remark-math', 'rehype-katex'],
        },
      },
    },
  },
  server: {
    port: serverPort,
    host: serverHost,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      // Only proxy backend auth routes, not /auth/callback (frontend route)
      '/auth/github': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/auth/google': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/auth/claude': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/auth/me': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/auth/logout': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/auth/providers': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/socket.io': {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
