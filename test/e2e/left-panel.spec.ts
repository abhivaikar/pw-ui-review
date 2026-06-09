import { test, expect } from '@playwright/test';
import { mockApi, makeState, defaultFailures } from './helpers';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('shows review progress and total, grouped by spec file', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('.failures');
  await expect(panel.getByText('0 of 3 reviewed')).toBeVisible();
  await expect(panel.getByText('3 failing visual checks')).toBeVisible();
  await expect(panel.getByText('checkout.spec.ts')).toBeVisible();
  await expect(panel.getByText('profile.spec.ts')).toBeVisible();
});

test('nests multiple snapshots of one test under a non-clickable group header', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.failure-group__header')).toHaveText('profile renders');
  await expect(page.locator('.failure-item--child')).toHaveCount(2);
  await expect(page.locator('.failure-item--child').first()).toContainText('profile-header');
});

test('collapses and expands a spec file', async ({ page }) => {
  await page.goto('/');
  const list = page.locator('.failures');
  const checkoutHeader = page.getByRole('button', { name: 'checkout.spec.ts' });
  await expect(list.getByText('form filled state matches')).toBeVisible();
  await checkoutHeader.click();
  await expect(list.getByText('form filled state matches')).toBeHidden();
  // other spec unaffected
  await expect(page.locator('.failure-group__header')).toBeVisible();
  await checkoutHeader.click();
  await expect(list.getByText('form filled state matches')).toBeVisible();
});

test('selecting an item loads it in the detail panel and marks it active', async ({ page }) => {
  await page.goto('/');
  await page.locator('.failures').getByText('profile-header', { exact: true }).click();
  await expect(page.locator('.failure-item--active')).toContainText('profile-header');
  await expect(page.locator('.detail-header__name')).toContainText('profile-header');
});

test('reviewed items carry their status indicator', async ({ page }) => {
  const failures = defaultFailures();
  failures[0].decision = 'updated';
  failures[1].decision = 'kept';
  await mockApi(page, { state: makeState({ failures }) });
  await page.goto('/');
  await expect(page.locator('.failures').getByText('2 of 3 reviewed')).toBeVisible();
  await expect(page.locator('.failure-item__indicator--pass')).toHaveCount(1);
  await expect(page.locator('.failure-item__indicator--kept')).toHaveCount(1);
});
