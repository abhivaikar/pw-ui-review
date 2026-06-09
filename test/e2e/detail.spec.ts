import { test, expect } from '@playwright/test';
import { mockApi, makeState, defaultFailures } from './helpers';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('renders the test › snapshot breadcrumb, path and pixel-diff summary', async ({ page }) => {
  await page.goto('/'); // auto-selects the first failure (checkout-form)
  const name = page.locator('.detail-header__name');
  await expect(name).toContainText('form filled state matches');
  await expect(name).toContainText('checkout-form');
  await expect(page.locator('.detail-header__path')).toContainText('e2e/checkout.spec.ts:5');
  await expect(page.locator('.detail-header__diff')).toContainText('2,340 pixels different (1.23%)');
});

test('shows step rows, the FAILED badge, and the exact assertion code', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.step-row').first()).toContainText("page.goto('/checkout')");
  await expect(page.locator('.step-row--failed')).toContainText('toHaveScreenshot');
  await expect(page.locator('.step-row__badge')).toHaveText('FAILED');
  await expect(page.locator('.step-code')).toContainText("toHaveScreenshot('checkout-form.png')");
});

test('falls back gracefully when the reporter recorded no steps', async ({ page }) => {
  await page.goto('/');
  await page.locator('.failures').getByText('profile-header', { exact: true }).click();
  await expect(page.getByText(/Step details aren.t available/)).toBeVisible();
  await expect(page.locator('.step-row')).toHaveCount(0);
});

test('action buttons show consequence captions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.action__caption').nth(0)).toContainText("Replaces the baseline with this run's actual screenshot");
  await expect(page.locator('.action__caption').nth(1)).toContainText('Leaves the baseline unchanged');
});

test('reject replaces the buttons with post-rejection guidance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Keep current baseline' }).click();
  await expect(page.getByText(/Baseline unchanged\. This test will continue to fail/)).toBeVisible();
  await expect(page.getByText(/What you can do next/)).toBeVisible();
});

test('approve shows the confirmation and posts the decision', async ({ page }) => {
  await page.goto('/');
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/decision') && r.method() === 'POST'),
    page.getByRole('button', { name: 'Update baseline' }).click(),
  ]);
  expect(JSON.parse(request.postData() || '{}')).toMatchObject({ decision: 'updated' });
  await expect(page.getByText('Baseline updated. ✓')).toBeVisible();
});

test('an updated snapshot marks the diff stale with a re-run note', async ({ page }) => {
  const failures = defaultFailures();
  failures[0].decision = 'updated';
  await mockApi(page, { state: makeState({ failures }) });
  await page.goto('/');
  await page.locator('.failures').getByText('form filled state matches').click();
  await expect(page.locator('.diff-stale-note')).toContainText('Re-run your Playwright tests to verify');
  await expect(page.locator('.diff-panel--stale')).toBeVisible();
  await expect(page.locator('.detail-header__diff--stale')).toBeVisible();
  // The action bar now states the decision instead of showing raw buttons.
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline updated');
});
