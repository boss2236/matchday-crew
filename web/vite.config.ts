import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built files go to web/dist, which the Node server serves. In development,
// `npm run dev` here proxies the API to the server on port 3000.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
  },
});
