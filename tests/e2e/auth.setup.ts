// tests/e2e/auth.setup.ts
//
// Phase 11 — Playwright global setup. Runs once before any e2e spec.
//
// Creates (or signs into) a known test user, captures cookies via
// `request.storageState()`, and writes them to a JSON file. The
// playwright.config.ts then uses that file as the default `storageState`,
// so every spec starts already-signed-in.
//
// The login-redirect spec opts out by passing an empty storageState in its
// own `test.use(...)` block — that's the only spec that needs to see the
// signed-out experience.

import { request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const TEST_EMAIL =
  process.env.E2E_TEST_EMAIL ?? 'e2e+phase11@autoride.test';
const TEST_PASSWORD =
  process.env.E2E_TEST_PASSWORD ?? 'phase11-e2e-password-1234';
const TEST_NAME = 'E2E Operator';
const STATE_PATH = path.join(__dirname, '.auth', 'state.json');

export default async function globalSetup(): Promise<void> {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  const ctx = await request.newContext({ baseURL: BASE_URL });

  // Try sign-in first; if the test user doesn't exist yet, sign-up creates
  // them and the autoSignIn config ensures the response also sets cookies.
  let signIn = await ctx.post('/api/auth/sign-in/email', {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });

  if (!signIn.ok()) {
    const signUp = await ctx.post('/api/auth/sign-up/email', {
      data: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      },
    });
    if (!signUp.ok()) {
      throw new Error(
        `[e2e setup] sign-up failed: ${signUp.status()} ${await signUp.text()}`,
      );
    }
    signIn = await ctx.post('/api/auth/sign-in/email', {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    if (!signIn.ok()) {
      throw new Error(
        `[e2e setup] sign-in failed after sign-up: ${signIn.status()} ${await signIn.text()}`,
      );
    }
  }

  await ctx.storageState({ path: STATE_PATH });
  await ctx.dispose();
}
