import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sourceFingerprint } from '../src/version.ts';

// Built files go to web/dist, which the Node server serves. In development,
// `npm run dev` here proxies the API to the server on port 3000.
export default defineConfig({
  base: './',
  // Lets the app warn when the running server is older or newer than this build.
  define: { __SERVER_BUILD__: JSON.stringify(sourceFingerprint(new URL('../src/', import.meta.url).pathname)) },
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
  },
});
