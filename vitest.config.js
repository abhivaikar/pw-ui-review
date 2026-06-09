import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Per-file environment: Node modules run in node, UI component tests opt
    // into jsdom via a `// @vitest-environment jsdom` docblock at the top.
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    // Integration tests (./demo submodule) are excluded from the default run;
    // they are opt-in via `npm run test:integration` once they exist.
    exclude: ['node_modules', 'dist', 'demo', 'test/integration/**', 'test/e2e/**'],
  },
});
