// tests/e2e/login-redirect.spec.ts
//
// Phase 11 acceptance test: the auth boundary actually gates the dashboard.
//
// Most specs in this folder run with the default signed-in storageState
// from tests/e2e/auth.setup.ts. This file deliberately overrides with an
// empty state so it can verify the unauthenticated experience, then the
// sign-up → sign-in → sign-out round-trip.

import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('phase-11 auth boundary', () => {
  test('signed-out visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('signed-out visit to /chat carries ?next=…', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/login\?next=%2Fchat/);
  });

  test('/health stays public', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('sign-up + sign-in unlocks the dashboard, then sign-out re-locks it', async ({
    page,
  }) => {
    // Use a unique email per run so re-running locally doesn't collide.
    const email = `e2e-redirect-${Date.now()}@autoride.test`;
    const password = 'redirect-test-password-1234';

    await page.goto('/register');
    await page.getByPlaceholder(/your name/i).fill('Redirect Test');
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Auto-sign-in lands on /
    await expect(page).toHaveURL(/(localhost:\d+)?\/$/);
    // The TopNav user pill shows the email we just registered with.
    await expect(page.getByText(email, { exact: false })).toBeVisible();

    // Sign out via the TopNav button.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login(\?|$)/);

    // Going back to / still bounces — session is gone.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
});
