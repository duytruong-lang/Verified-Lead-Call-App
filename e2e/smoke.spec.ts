import { expect, test } from '@playwright/test';

test('foundation landing screen renders synthetic demo lead', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Không gian xác minh lead' })).toBeVisible();
  await expect(page.getByText('Demo dữ liệu giả')).toBeVisible();
  await expect(page.getByText('+00-000-000-0001')).toBeVisible();
  await page.getByRole('button', { name: /Lead mẫu 01/ }).click();
  await expect(page.getByRole('heading', { name: 'Lead mẫu 01' })).toBeVisible();
});
