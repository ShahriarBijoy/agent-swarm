import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Phase 11 — every dashboard route is now session-gated. The default
// storageState below is captured by tests/e2e/auth.setup.ts (a global
// setup) so existing specs (dashboard.spec.ts, etc.) start signed-in.
//
// The login-redirect spec opts out of the default state by passing an
// empty cookie store via test.use({ storageState: { cookies: [], … } }).

const STATE_PATH = path.join(__dirname, 'tests', 'e2e', '.auth', 'state.json');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  globalSetup: path.join(__dirname, 'tests', 'e2e', 'auth.setup.ts'),
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    storageState: STATE_PATH,
  },
  webServer: {
    command: 'pnpm dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
