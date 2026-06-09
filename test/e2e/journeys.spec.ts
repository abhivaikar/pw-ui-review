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

test('review every failure by approving — auto-advances to completion', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  await expect(detailName(page)).toContainText('checkout-form');
  await approve(page);
  await expect(page.getByText('Baseline updated. ✓')).toBeVisible();

  // Auto-advance (after the confirmation delay) to the next unreviewed failure.
  await expect(detailName(page)).toContainText('profile-header');
  await approve(page);
  await expect(detailName(page)).toContainText('profile-footer');
  await approve(page);

  // All reviewed -> session complete with the right tally.
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

  // Approve the first -> auto-advances to profile-header.
  await approve(page);
  await expect(detailName(page)).toContainText('profile-header');

  // Reject profile-header: guidance shown, NO auto-advance (stays put).
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
  await approve(page);                              // checkout-form -> updated, advances
  await expect(detailName(page)).toContainText('profile-header');

  // Go back to the approved item: it shows the decision banner, NOT raw buttons.
  await page.locator('.failures').getByText('form filled state matches').click();
  await expect(page.locator('.decision-bar__label')).toContainText('Baseline updated');
  await expect(page.getByRole('button', { name: 'Update baseline' })).toHaveCount(0);

  // Change decision -> buttons reappear -> choose Keep to flip it.
  await page.getByRole('button', { name: 'Change decision' }).click();
  await reject(page);
  await expect(page.getByText(/Baseline unchanged/)).toBeVisible();
  await expect(page.locator('.failures').getByText('1 of 3 reviewed')).toBeVisible();
});

test('external import journey: choose file, confirm, item is resolved and advances', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(detailName(page)).toContainText('checkout-form');

  await page.locator('[data-testid="import-input"]').setInputFiles({
    name: 'design-export.png', mimeType: 'image/png', buffer: PNG,
  });
  await page.getByRole('button', { name: 'Confirm import' }).click();

  await expect(page.getByText('Baseline updated. ✓')).toBeVisible();
  await expect(detailName(page)).toContainText('profile-header'); // advanced past the imported one
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
