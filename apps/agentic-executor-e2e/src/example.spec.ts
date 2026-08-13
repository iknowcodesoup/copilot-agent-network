import { test, expect } from '@playwright/test';

test('shows the voice model dashboard', async ({ page }) => {
  await page.goto('/');

  // One page: the dashboard is the app, and the chat docks beside it.
  await expect(page.locator('h1')).toContainText('Voice models');
});
