import { test, expect } from '@playwright/test';

test.describe('phase-10 dashboards', () => {
  test('home renders with greeting + bento cells', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Hi /)).toBeVisible();
    await expect(page.getByText(/here's/)).toBeVisible();
    await expect(page.locator('[data-testid="bento-home"], .grid')).toBeVisible();
  });

  test('/tasks shows five kanban columns', async ({ page }) => {
    await page.goto('/tasks');
    for (const title of ['Queued', 'In progress', 'Awaiting approval', 'Done', 'Failed']) {
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test('/agents/fleet-analyst renders the metric strip', async ({ page }) => {
    await page.goto('/agents/fleet-analyst');
    await expect(page.getByText('p50 / p95 latency', { exact: false })).toBeVisible();
    await expect(page.getByText('Daily tokens')).toBeVisible();
    await expect(page.getByText('Success rate')).toBeVisible();
  });

  test('/memories shows filter pills + table', async ({ page }) => {
    await page.goto('/memories');
    await expect(page.getByText(/Bucket/i)).toBeVisible();
    await expect(page.getByText(/Segment/i)).toBeVisible();
  });

  test('invalid agent returns 404', async ({ page }) => {
    const res = await page.goto('/agents/totally-fake');
    expect(res?.status()).toBe(404);
  });
});
