import { defineConfig, devices } from '@playwright/test';

// Playwright tests for pw-ui-review's OWN UI, in isolation. The backend API is
// stubbed per-test via page.route (see test/e2e/helpers.ts), so these exercise
// UI behavior only — rendering, interactions, theming — not the Express server.
// The built UI is served statically by `vite preview`.
//
// Two run profiles, switched by the CI env var (GitHub Actions sets CI=true):
//   - local: screenshots for EVERY test (pass or fail), no retries
//   - CI:    screenshots ONLY on failure, retries, GitHub annotations
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(isCI ? [['github'] as const] : []),
  ],
  use: {
    baseURL: 'http://localhost:4173',
    // Local: always capture (handy for eyeballing). CI: only on failure.
    screenshot: isCI ? 'only-on-failure' : 'on',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
