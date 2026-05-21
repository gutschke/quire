import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Quire end-to-end tests.  Boots a peerjs-server
 * broker in `e2e/global-setup.ts` (port communicated via env var) and
 * a vite dev server here.  Each spec opens browser contexts that point
 * the runtime at the local broker via URL params.
 *
 * Run with: `npm run test:e2e`
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // shared broker port; keep tests serial
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    actionTimeout: 10000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
