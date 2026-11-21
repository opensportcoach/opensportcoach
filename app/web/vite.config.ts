import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served by app/channel/server.ts in every mode; in development, Vite serves the UI with
// hot reload and proxies /api to the fixtures server (dev.mjs starts both).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5281', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom' },
});
