import { test, expect } from '@playwright/test';
import { mockApi } from './helpers';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('the theme toggle cycles Auto → Light → Dark → Auto', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const toggle = page.getByRole('button', { name: /Auto|Light|Dark/ });

  await expect(toggle).toContainText('Auto');
  expect(await html.getAttribute('data-theme')).toBeNull(); // auto = follow OS, no override

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toContainText('Light');

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toContainText('Dark');

  await toggle.click();
  expect(await html.getAttribute('data-theme')).toBeNull(); // back to Auto
});

test('switching theme actually recolors the UI via CSS variables', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /Auto|Light|Dark/ });
  const panelBg = () => page.locator('.failures').evaluate((el) => getComputedStyle(el).backgroundColor);

  await toggle.click(); // Light
  const light = await panelBg();
  await toggle.click(); // Dark
  const dark = await panelBg();

  expect(light).not.toBe(dark);
});

test('the manual choice persists across a reload', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /Auto|Light|Dark/ });
  await toggle.click(); // Light
  await toggle.click(); // Dark
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
