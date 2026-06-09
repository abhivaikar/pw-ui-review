import { test, expect } from '@playwright/test';
import { mockApi, makeState } from './helpers';

// End-to-end critical user journeys (UI in isolation, backend stubbed).

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const detailName = (page) => page.locator('.detail-header__name');
const approve = (page) => page.getByRole('button', { name: 'Update baseline' }).click();
const reject = (page) => page.getByRole('button', { name: 'Keep current baseline' }).click();

test('review every failure to completion — no auto-advance between items', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  await expect(detailName(page)).toContainText('checkout-form');
  await approve(page);

  // No auto-advance: we stay on the same failure, now showing its decision.
  await expect(detailName(page)).toContainText('checkout-form');
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline updated');

  // Manually advance to each remaining failure and approve it.
  await page.locator('.failures').getByText('profile-header', { exact: true }).click();
  await approve(page);
  await expect(detailName(page)).toContainText('profile-header');

  await page.locator('.failures').getByText('profile-footer', { exact: true }).click();
  await approve(page);

  // Approving the LAST one completes the session -> the summary takes over.
  await expect(page.getByText('Session complete')).toBeVisible();
  const nums = page.locator('.session-complete__num');
  await expect(nums.nth(0)).toHaveText('3'); // updated
  await expect(nums.nth(1)).toHaveText('0'); // kept
  await expect(nums.nth(3)).toHaveText('3'); // total reviewed
  await expect(page.locator('.failures').getByText('3 of 3 reviewed')).toBeVisible();
});

test('mixed approve + reject session reaches completion with the correct tally', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // Approve the first -> stays on checkout-form (no advance).
  await approve(page);
  await expect(detailName(page)).toContainText('checkout-form');

  // Manually go to profile-header and reject it: guidance shown, stays put.
  await page.locator('.failures').getByText('profile-header', { exact: true }).click();
  await reject(page);
  await expect(page.getByText(/Baseline unchanged\. This test will continue to fail/)).toBeVisible();
  await expect(page.locator('.failure-item--active')).toContainText('profile-header');

  // Manually pick the last one and approve it -> completes the session.
  await page.locator('.failures').getByText('profile-footer', { exact: true }).click();
  await approve(page);

  await expect(page.getByText('Session complete')).toBeVisible();
  const nums = page.locator('.session-complete__num');
  await expect(nums.nth(0)).toHaveText('2'); // updated
  await expect(nums.nth(1)).toHaveText('1'); // kept
  await expect(nums.nth(3)).toHaveText('3'); // total reviewed
});

test('rejecting keeps you on the same failure (no auto-advance)', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(detailName(page)).toContainText('checkout-form');
  await reject(page);
  // Give any (non-existent) advance timer a chance to fire, then assert we stayed.
  await page.waitForTimeout(500);
  await expect(detailName(page)).toContainText('checkout-form');
  await expect(page.locator('.failure-item--active')).toContainText('form filled state matches');
});

test('revisiting an approved failure shows its decision, and Change lets you flip it', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await approve(page);                              // checkout-form -> updated, stays here

  // The approved item shows the decision banner, NOT raw buttons.
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline updated');
  await expect(page.getByRole('button', { name: 'Update baseline' })).toHaveCount(0);

  // Navigate away and back: the decision persists.
  await page.locator('.failures').getByText('profile-header', { exact: true }).click();
  await page.locator('.failures').getByText('form filled state matches').click();
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline updated');

  // Change decision -> buttons reappear -> choose Keep to flip it.
  await page.getByRole('button', { name: 'Change decision' }).click();
  await reject(page);
  await expect(page.getByText(/Baseline unchanged/)).toBeVisible();
  await expect(page.locator('.failures').getByText('1 of 3 reviewed')).toBeVisible();
});

test('external import journey: choose file, confirm, item is resolved (no advance)', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(detailName(page)).toContainText('checkout-form');

  await page.locator('[data-testid="import-input"]').setInputFiles({
    name: 'design-export.png', mimeType: 'image/png', buffer: PNG,
  });
  await page.getByRole('button', { name: 'Confirm import' }).click();

  // Stays on the imported item, showing the decision banner — no advance.
  await expect(detailName(page)).toContainText('checkout-form');
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline imported');
  await expect(page.locator('.failures').getByText('1 of 3 reviewed')).toBeVisible();
});

test('empty result set shows the "nothing to review" state', async ({ page }) => {
  await mockApi(page, { state: makeState({ failures: [] }) });
  await page.goto('/');
  await expect(page.getByText(/No visual snapshot failures found/)).toBeVisible();
  await expect(page.locator('.failures').getByText('0 failing visual checks')).toBeVisible();
});

test('stale-results warning surfaces in the left panel', async ({ page }) => {
  await mockApi(page, { state: makeState({ stale: { isStale: true, ageText: '3 days ago' } }) });
  await page.goto('/');
  await expect(page.getByText(/Results are 3 days ago/)).toBeVisible();
});
