import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI is a small SPA served by the Express server in production.
// In dev, Vite serves it on :5173 and proxies API calls to the running tool.
export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
});
