import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

function wavFixture() {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / 8000) * 9000), 44 + index * 2);
  return { name: 'cuoc-goi-mau.wav', mimeType: 'audio/wav', buffer };
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: 'Xác minh lead' })).toBeVisible(); });

test('upload, save verified outcome, persist, and play public link without lead details', async ({ page, context }) => {
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await expect(page.getByText('Đang giữ lượt gọi')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(wavFixture());
  await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible();
  await page.getByRole('button', { name: 'Có quan tâm' }).click();
  await page.getByLabel(/Đã xác minh/).check();
  await page.screenshot({ path: '/tmp/verified-call-ui.png', fullPage: true });
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByText('Đã lưu kết quả và bàn giao bản ghi.')).toBeVisible();
  const handoff = page.getByRole('link', { name: 'Mở link nghe' });
  const href = await handoff.getAttribute('href');
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:4173\/r\//);
  await page.getByRole('button', { name: 'Đã kết thúc' }).click();
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await expect(page.getByText('Lượt 1 · Có quan tâm')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Đã kết thúc/ }).click();
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await expect(page.getByText('Lượt 1 · Có quan tâm')).toBeVisible();
  const publicPage = await context.newPage();
  await publicPage.goto(href!);
  await expect(publicPage.getByText(/REC-/)).toBeVisible();
  await expect(publicPage.locator('audio')).toBeVisible();
  await expect(publicPage.getByText('Nguyễn Minh Anh')).toHaveCount(0);
  await expect(publicPage.getByText('+00-000-000-0001')).toHaveCount(0);
});

test('records from the fake microphone, saves, and opens the listening page', async ({ page, context }) => {
  await page.context().grantPermissions(['microphone']);
  await page.getByRole('button', { name: /Võ Ngọc Linh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByRole('button', { name: /Ghi âm/ }).click();
  await expect(page.getByText('Đang ghi âm cuộc gọi')).toBeVisible();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: /Dừng ghi âm/ }).click();
  await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible({ timeout: 8000 });
  const sample = await page.locator('.rec-copy audio').evaluate(async (audio: HTMLAudioElement) => Array.from(new Uint8Array(await (await fetch(audio.src)).arrayBuffer())));
  writeFileSync('/tmp/verified-call-fake-mic.webm', Buffer.from(sample));
  await page.getByRole('button', { name: 'Có quan tâm' }).click();
  await page.getByLabel(/Đã xác minh/).check();
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  const handoff = page.getByRole('link', { name: 'Mở link nghe' });
  await expect(handoff).toBeVisible();
  const href = await handoff.getAttribute('href');
  const publicPage = await context.newPage();
  await publicPage.goto(href!);
  await expect(publicPage.locator('audio')).toBeVisible();
  await expect(publicPage.getByText(/REC-/)).toBeVisible();
  const downloadPromise = publicPage.waitForEvent('download');
  await publicPage.getByRole('button', { name: /Tải bản ghi xuống/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^REC-.*\.webm$/);
});

test('requires a note for other and rejects unplayable audio', async ({ page }) => {
  await page.getByRole('button', { name: /Trần Quốc Bảo/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByRole('button', { name: 'Khác', exact: true }).click();
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByRole('alert')).toContainText('Vui lòng nhập ghi chú');
  await page.getByLabel(/Ghi chú cuộc gọi/).fill('Khách cần gọi vào buổi tối');
  await page.locator('input[type="file"]').setInputFiles({ name: 'loi.wav', mimeType: 'audio/wav', buffer: Buffer.from('not an audio file') });
  await expect(page.getByRole('alert')).toContainText('không giải mã được audio');
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByText('Đã lưu kết quả. Sheet sẽ đồng bộ nền.')).toBeVisible();
  await page.getByRole('button', { name: 'Đã kết thúc' }).click();
  await page.getByRole('button', { name: /Trần Quốc Bảo/ }).click();
  await expect(page.getByText('Lượt 1 · Khác')).toBeVisible();
});

test('blocks the sixth saved contact attempt while keeping final evaluation available', async ({ page }) => {
  await page.getByRole('button', { name: /Lê Thu Hà/ }).click();
  for (let index = 1; index <= 5; index += 1) {
    if (index > 1) {
      await page.getByRole('button', { name: 'Đã kết thúc' }).click();
      await page.getByRole('button', { name: /Lê Thu Hà/ }).click();
    }
    await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
    await page.getByRole('button', { name: 'Thuê bao/máy bận' }).click();
    await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  }
  await page.getByRole('button', { name: 'Đã kết thúc' }).click();
  await page.getByRole('button', { name: /Lê Thu Hà/ }).click();
  await expect(page.getByText('Đã đủ 5 lượt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đã xác minh' })).toBeEnabled();
  await expect(page.getByText('5 lượt', { exact: false }).first()).toBeVisible();
});
