import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

type FixtureUser = { email: string; password: string };
type FixtureManifest = { users: Record<string, FixtureUser>; e2eAdmin?: string; tag: string };
const fixturePath = process.env.SUPABASE_E2E_USERS_FILE ?? '.supabase/backend-test-users.json';
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureManifest;
const admin = fixtures.users[fixtures.e2eAdmin ?? 'admin-keeper'];


async function signIn(page: Page, user: FixtureUser, password = user.password) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Email công việc').fill(user.email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Xác minh lead' })).toBeVisible();
}

async function createLink(page: Page, action: 'invite' | 'recovery', email: string) {
  await page.getByRole('button', { name: 'Thành viên' }).click();
  await expect(page.getByRole('dialog', { name: 'Thành viên workspace' })).toBeVisible();
  const row = page.locator('.team-member').filter({ hasText: email });
  await expect(row).toBeVisible();
  const button = action === 'invite'
    ? row.getByRole('button', { name: 'Gửi lại link' })
    : row.getByRole('button', { name: `Tạo link khôi phục cho ${email}` });
  await button.click();
  await expect(page.getByRole('status')).toContainText(action === 'invite' ? 'liên kết mời' : 'liên kết khôi phục');
  const value = await page.getByLabel('Liên kết dùng một lần').inputValue();
  expect(value).toContain('/auth/confirm?token_hash=');
  return value;
}

async function setPassword(page: Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Tạo mật khẩu' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Mật khẩu mới').fill(password);
  await page.getByLabel('Nhập lại mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Mật khẩu đã được cập nhật');
  expect(await page.evaluate(() => window.location.search)).not.toContain('token_hash');
}

async function trackSyntheticUser(email: string) {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_E2E_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) {
    throw new Error('Synthetic account cleanup tracking is restricted to the local Supabase fixture.');
  }
  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc('team_find_auth_user', { p_email: email });
  if (error) throw error;
  const userId = (data as Array<{ user_id?: string }> | null)?.[0]?.user_id;
  if (!userId) throw new Error('Could not register the synthetic invite in the local cleanup manifest.');
  const manifestPath = process.env.SUPABASE_E2E_USERS_FILE ?? fixturePath;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest & { localOnly?: boolean };
  if (manifest.localOnly !== true || !email.endsWith(`-${manifest.tag}@example.invalid`)) {
    throw new Error('Refusing to register an untagged or non-local synthetic identity.');
  }
  manifest.users[`browser-${userId}`] = { email, id: userId } as FixtureUser;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

test('local Supabase: pending invite setup and active recovery both return to password sign-in', async ({ page, browser }) => {
  test.skip(!admin || !fixtures.tag, 'The local backend fixture manifest is not ready.');
  if (!admin || !fixtures.tag) return;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Email công việc').fill(admin.email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill('invalid-synthetic-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu chưa chính xác.');
  await signIn(page, admin);

  const memberEmail = `browser-auth-${randomUUID()}-${fixtures.tag}@example.invalid`;
  await page.getByRole('button', { name: 'Thành viên' }).click();
  await page.getByRole('button', { name: 'Mời thành viên' }).click();
  await page.getByLabel('Email công việc').fill(memberEmail);
  await page.getByRole('button', { name: 'Tạo liên kết mời' }).click();
  await expect(page.getByRole('status')).toContainText('Đã tạo liên kết mời');
  const inviteLink = await page.getByLabel('Liên kết dùng một lần').inputValue();
  expect(inviteLink).toContain('/auth/confirm?token_hash=');
  await trackSyntheticUser(memberEmail);
  await page.locator('.ui-dialog-close').click();
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const invitedPassword = `PilotInvite-${randomUUID()}-A9!`;
  await setPassword(memberPage, inviteLink, invitedPassword);
  await signIn(memberPage, { email: memberEmail, password: invitedPassword });
  await memberContext.close();

  const recoveryLink = await createLink(page, 'recovery', memberEmail);
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  const recoveredPassword = `PilotRecovery-${randomUUID()}-B7!`;
  await setPassword(recoveryPage, recoveryLink, recoveredPassword);
  await signIn(recoveryPage, { email: memberEmail, password: recoveredPassword });

  const memberRow = page.locator('.team-member').filter({ hasText: memberEmail });
  await expect(memberRow).toContainText('Đang hoạt động');
  await memberRow.getByRole('combobox', { name: `Quyền của ${memberEmail}` }).click();
  await page.getByRole('option', { name: 'Chỉ xem' }).click();
  await expect(memberRow).toContainText('Chỉ xem');
  await recoveryPage.reload();
  await expect(recoveryPage.getByRole('heading', { name: 'Xác minh lead' })).toBeVisible();
  await recoveryPage.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await expect(recoveryPage.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
  await expect(recoveryPage.getByRole('button', { name: /Bắt đầu gọi/ })).toHaveCount(0);
  await expect(recoveryPage.getByRole('link', { name: /^Gọi/ })).toHaveCount(0);
  await expect(recoveryPage.getByRole('button', { name: 'Đã xác minh' })).toHaveCount(0);

  await memberRow.getByRole('button', { name: `Thu hồi quyền truy cập của ${memberEmail}` }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await expect(memberRow).toContainText('Đã vô hiệu hóa');
  await recoveryPage.reload();
  await expect(recoveryPage.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await recoveryContext.close();
});

test('local Supabase: viewer fixture is read-only', async ({ page }) => {
  const viewer = fixtures.users.viewer;
  test.skip(!viewer, 'The local backend viewer fixture is not ready.');
  if (!viewer) return;
  await signIn(page, viewer);
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bắt đầu gọi/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Gọi/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đã xác minh' })).toHaveCount(0);
});

test('local Supabase: temporary Auth outage stops the microphone and preserves the recorded draft', async ({ page }) => {
  test.skip(!admin, 'The local backend admin fixture is not ready.');
  if (!admin) return;
  await signIn(page, admin);
  await page.context().grantPermissions(['microphone']);
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByRole('button', { name: /Ghi âm/ }).click();
  await expect(page.getByText('Đang ghi âm cuộc gọi')).toBeVisible();
  await page.waitForTimeout(500);
  await page.route('**/auth/v1/user', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'service unavailable' }) }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('Không thể kiểm tra quyền truy cập');
  await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Có quan tâm' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
  await page.unroute('**/auth/v1/user');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Có quan tâm' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
});
