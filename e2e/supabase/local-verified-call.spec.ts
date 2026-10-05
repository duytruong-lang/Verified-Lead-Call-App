import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

type TestUserFile = { users: { 'staff-a': { email: string; password: string } } };
type RecordingRow = { object_key: string | null };
const fixturePath = process.env.SUPABASE_E2E_USERS_FILE!;
const staff = (JSON.parse(readFileSync(fixturePath, 'utf8')) as TestUserFile).users['staff-a'];
const apiUrl = process.env.VITE_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_E2E_SERVICE_ROLE_KEY!;
const serviceHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };

async function removeLeadFixture(leadId: string) {
  const recordingsResponse = await fetch(`${apiUrl}/rest/v1/recordings?lead_id=eq.${leadId}&select=object_key`, { headers: serviceHeaders });
  if (!recordingsResponse.ok) throw new Error(`Could not inspect the local test recordings (HTTP ${recordingsResponse.status}).`);
  const recordings = await recordingsResponse.json() as RecordingRow[];
  const keys = recordings.flatMap((row) => row.object_key ? [row.object_key] : []);
  const recordingIdsResponse = await fetch(`${apiUrl}/rest/v1/recordings?lead_id=eq.${leadId}&select=id`, { headers: serviceHeaders });
  if (!recordingIdsResponse.ok) throw new Error(`Could not inspect local test recording IDs (HTTP ${recordingIdsResponse.status}).`);
  const recordingIds = (await recordingIdsResponse.json() as Array<{ id: string }>).map((row) => row.id);
  if (keys.length) {
    const storageDelete = await fetch(`${apiUrl}/storage/v1/object/lead-recordings`, { method: 'DELETE', headers: serviceHeaders, body: JSON.stringify({ prefixes: keys }) });
    if (!storageDelete.ok) throw new Error(`Could not remove local test audio (HTTP ${storageDelete.status}).`);
  }
  async function deleteRows(table: string, query: URLSearchParams) {
    const response = await fetch(`${apiUrl}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { ...serviceHeaders, Prefer: 'return=minimal' } });
    if (!response.ok) throw new Error(`Could not clean local test table ${table} (HTTP ${response.status}).`);
  }
  await deleteRows('handoff_versions', new URLSearchParams({ lead_id: `eq.${leadId}` }));
  await deleteRows('current_handoffs', new URLSearchParams({ lead_id: `eq.${leadId}` }));
  if (recordingIds.length) await deleteRows('recording_shares', new URLSearchParams({ recording_id: `in.(${recordingIds.join(',')})` }));
  await deleteRows('recordings', new URLSearchParams({ lead_id: `eq.${leadId}` }));
  await deleteRows('contact_attempts', new URLSearchParams({ lead_id: `eq.${leadId}` }));
  await deleteRows('leads', new URLSearchParams({ id: `eq.${leadId}` }));
}

test('local Supabase: staff records, verifies, anonymous client listens/downloads, then revoke denies access', async ({ page, browser }) => {
  const leadId = randomUUID();
  await removeLeadFixture(leadId);
  const inserted = await fetch(`${apiUrl}/rest/v1/leads`, {
    method: 'POST', headers: { ...serviceHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ id: leadId, phone: '+00-000-000-0999', display_name: `Browser E2E ${leadId.slice(0, 8)}`, source: 'Local Supabase E2E', form_answers: { test: 'Synthetic only' } }),
  });
  if (!inserted.ok) throw new Error(`Local Supabase test fixture setup failed with HTTP ${inserted.status}.`);

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await page.getByLabel('Email công việc').fill(staff.email);
    await page.getByLabel('Mật khẩu').fill(staff.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByRole('heading', { name: 'Xác minh lead' })).toBeVisible();
    const leadName = `Browser E2E ${leadId.slice(0, 8)}`;
    await page.getByRole('button', { name: new RegExp(leadName) }).click();
    await expect(page.getByRole('heading', { name: leadName })).toBeVisible();
    await page.context().grantPermissions(['microphone']);
    await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
    await page.getByRole('button', { name: /Ghi âm/ }).click();
    await expect(page.getByText('Đang ghi âm cuộc gọi')).toBeVisible();
    await page.waitForTimeout(1300);
    await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
    await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Có quan tâm' }).click();
    await page.getByLabel(/Đã xác minh/).check();
    await page.getByRole('button', { name: /Lưu kết quả/ }).click();
    await expect(page.getByText('Đã lưu kết quả và bàn giao bản ghi.')).toBeVisible({ timeout: 20_000 });
    const handoff = page.getByRole('link', { name: 'Mở link nghe' });
    const publicUrl = await handoff.getAttribute('href');
    expect(publicUrl).toMatch(/\/r\//);

    const anonymousContext = await browser.newContext({ acceptDownloads: true });
    const publicPage = await anonymousContext.newPage();
    await publicPage.goto(publicUrl!);
    await expect(publicPage.getByRole('heading', { name: /^[0-9A-F]{10}$/ })).toBeVisible();
    await expect(publicPage.locator('audio')).toBeVisible();
    await expect.poll(() => publicPage.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => publicPage.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(0);
    expect(await publicPage.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith('-auth-token')))).toBe(false);
    await expect(publicPage.getByText(leadName)).toHaveCount(0);
    await expect(publicPage.getByText('+00-000-000-0999')).toHaveCount(0);
    await publicPage.locator('audio').evaluate(async (audio: HTMLAudioElement) => { audio.currentTime = 0; await audio.play(); });
    await expect.poll(() => publicPage.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.1);
    const downloadPromise = publicPage.waitForEvent('download');
    await publicPage.getByRole('button', { name: /Tải bản ghi xuống/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^[0-9A-F]{10}\.webm$/);
    const downloadedFile = await download.path();
    expect(downloadedFile).toBeTruthy();
    expect((await stat(downloadedFile!)).size).toBeGreaterThan(100);
    await download.saveAs('test-results/local-supabase-sample.webm');

    await page.getByRole('button', { name: 'Đã kết thúc' }).click();
    await page.getByRole('button', { name: new RegExp(leadName) }).click();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Thu hồi link/ }).click();
    await expect(page.getByText('Đã thu hồi link.')).toBeVisible();
    const revokedAnonymousContext = await browser.newContext();
    const revokedPage = await revokedAnonymousContext.newPage();
    await revokedPage.goto(publicUrl!);
    await expect(revokedPage.getByRole('heading', { name: 'Không mở được bản ghi' })).toBeVisible();
    await revokedAnonymousContext.close();
    await anonymousContext.close();
  } finally {
    await removeLeadFixture(leadId);
  }
});
