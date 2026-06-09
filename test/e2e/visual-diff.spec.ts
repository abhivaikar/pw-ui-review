import { test, expect } from '@playwright/test';
import { mockApi } from './helpers';

test('compare-mode tabs switch the view', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // Side by side (default): three panels.
  await expect(page.locator('.diff-panel')).toHaveCount(3);

  await page.getByRole('button', { name: 'Actual' }).click();
  await expect(page.locator('.diff-single__img-wrap')).toHaveCount(1);
  await expect(page.locator('.diff-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expected' }).click();
  await expect(page.getByAltText('Expected')).toBeVisible();

  await page.getByRole('button', { name: 'Slider' }).click();
  await expect(page.locator('.slider')).toBeVisible();
  await expect(page.locator('.slider__divider')).toBeVisible();
});

test('the slider divider is draggable', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Slider' }).click();

  const divider = page.locator('.slider__divider');
  const before = await divider.evaluate((el: HTMLElement) => el.style.left);

  const box = (await page.locator('.slider').boundingBox())!;
  const handle = (await page.locator('.slider__handle').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up();

  const after = await divider.evaluate((el: HTMLElement) => el.style.left);
  expect(after).not.toBe(before);
});

test('clicking an image opens the full-screen overlay; Escape closes it', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByAltText('Expected').click();
  await expect(page.locator('.overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.overlay')).toHaveCount(0);
});

test('a failing image degrades to "Image unavailable"', async ({ page }) => {
  await mockApi(page, { failImages: true });
  await page.goto('/');
  await expect(page.getByText('Image unavailable').first()).toBeVisible();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('external import: choosing a matching file reveals the Confirm button', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.locator('[data-testid="import-input"]').setInputFiles({ name: 'design.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible();
});

test('selecting a file previews it as "Imported" and leaves the EXPECTED panel untouched', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  // EXPECTED panel (Visual Diff section) before importing: the current baseline,
  // served from the API (not a local blob).
  const expectedImg = page.getByAltText('Expected');
  const beforeSrc = await expectedImg.getAttribute('src');
  expect(beforeSrc).toContain('/api/image/');
  expect(beforeSrc).not.toContain('blob:');
  await expect(page.locator('.visual-diff').getByText('current baseline')).toBeVisible();

  await page.locator('[data-testid="import-input"]').setInputFiles({
    name: 'design-export.png', mimeType: 'image/png', buffer: PNG,
  });

  // A SEPARATE preview appears in the Import section: "Imported" (a client-side
  // blob of the chosen file, captioned with the filename) next to "Actual".
  const preview = page.locator('.import-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByAltText('Imported')).toBeVisible();
  await expect(preview.getByText('design-export.png')).toBeVisible();
  await expect(preview.getByAltText('Actual')).toBeVisible();
  expect(await preview.getByAltText('Imported').getAttribute('src')).toContain('blob:');

  // The EXPECTED panel up top is UNCHANGED (same src, still "current baseline"),
  // and no decision was recorded — the left panel is untouched.
  await expect(expectedImg).toHaveAttribute('src', beforeSrc!);
  await expect(page.locator('.visual-diff').getByText('current baseline')).toBeVisible();
  await expect(page.locator('.visual-diff').getByText('imported baseline')).toHaveCount(0);
  await expect(page.locator('.failures').getByText('0 of 3 reviewed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update baseline' })).toBeVisible();
});

test('external import: a dimension mismatch shows an error and offers no Confirm', async ({ page }) => {
  await mockApi(page);
  // Override the validate stub to report a mismatch (later route wins).
  await page.route('**/api/import/**/validate**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, source: { width: 1280, height: 900 }, reference: { width: 1280, height: 800 } }),
    })
  );
  await page.goto('/');
  await page.locator('[data-testid="import-input"]').setInputFiles({ name: 'wrong.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(/Dimension mismatch: imported image is 1280×900, expected 1280×800/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
});
