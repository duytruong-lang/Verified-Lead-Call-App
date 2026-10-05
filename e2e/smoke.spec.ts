import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

function wavFixture(name = 'cuoc-goi-mau.wav', frequency = 440) {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * frequency / 8000) * 9000), 44 + index * 2);
  return { name, mimeType: 'audio/wav', buffer };
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
  const wavDownloadPromise = publicPage.waitForEvent('download');
  await publicPage.getByRole('button', { name: /Tải bản ghi xuống/ }).click();
  expect((await wavDownloadPromise).suggestedFilename()).toMatch(/^REC-.*\.wav$/);
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

test('retries a committed save with the original frozen idempotency key and counts one attempt', async ({ page }) => {
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByRole('button', { name: 'Có quan tâm' }).click();
  await page.evaluate(() => localStorage.setItem('verified-call-e2e-fault:save-lost-reply-once', 'once'));
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByRole('alert')).toContainText('response lost after the save committed');
  await expect(page.getByRole('button', { name: 'Có quan tâm' })).toBeDisabled();
  await expect(page.getByLabel(/Ghi chú cuộc gọi/)).toBeDisabled();
  await expect(page.getByRole('button', { name: /Lưu kết quả/ })).toBeEnabled();
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByText('Đã lưu kết quả. Sheet sẽ đồng bộ nền.')).toBeVisible();
  const leadState = await page.evaluate(() => (JSON.parse(localStorage.getItem('verified-call-demo-v1') ?? '{}') as { leads: Array<{ displayName: string; attemptCount: number; attempts: Array<{ state: string }> }> }).leads.find((item) => item.displayName === 'Nguyễn Minh Anh'));
  expect(leadState?.attemptCount).toBe(1);
  expect(leadState?.attempts.filter((attempt) => attempt.state === 'completed')).toHaveLength(1);
});

test('new audio after share failure invalidates ready recording and shares the replacement', async ({ page }) => {
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.locator('input[type="file"]').setInputFiles(wavFixture('take-one.wav', 440));
  await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible();
  await page.getByRole('button', { name: 'Có quan tâm' }).click();
  await page.getByLabel(/Đã xác minh/).check();
  await page.evaluate(() => localStorage.setItem('verified-call-e2e-fault:create-share-once', 'once'));
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByRole('alert')).toContainText('share creation unavailable');
  await page.locator('input[type="file"]').setInputFiles(wavFixture('take-two.wav', 660));
  await expect(page.getByText('take-two.wav')).toBeVisible();
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByText('Đã lưu kết quả và bàn giao bản ghi.')).toBeVisible();
  const handoffRecording = await page.evaluate(() => {
    const lead = (JSON.parse(localStorage.getItem('verified-call-demo-v1') ?? '{}') as { leads: Array<{ displayName: string; handoff: { recordingId: string } | null; recordings: Array<{ id: string; objectKey: string }> }> }).leads.find((item) => item.displayName === 'Nguyễn Minh Anh');
    return { handoff: lead?.handoff?.recordingId, newest: lead?.recordings.at(-1)?.id, filename: lead?.recordings.at(-1)?.objectKey };
  });
  expect(handoffRecording.handoff).toBe(handoffRecording.newest);
  expect(handoffRecording.filename).toBe('take-two.wav');
});

test('cancel during microphone recording ends the track and discards the late stop event', async ({ page }) => {
  await page.evaluate(() => {
    const browserWindow = window as Window & { __capturedCallTracks?: MediaStreamTrack[] };
    browserWindow.__capturedCallTracks = [];
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: async (constraints: MediaStreamConstraints) => {
      const stream = await original(constraints);
      browserWindow.__capturedCallTracks?.push(...stream.getAudioTracks());
      return stream;
    } });
  });
  await page.context().grantPermissions(['microphone']);
  await page.getByRole('button', { name: /Võ Ngọc Linh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByRole('button', { name: /Ghi âm/ }).click();
  await expect(page.getByText('Đang ghi âm cuộc gọi')).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Hủy lượt', exact: true }).click();
  await expect(page.getByRole('button', { name: /Bắt đầu gọi/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __capturedCallTracks?: MediaStreamTrack[] }).__capturedCallTracks?.[0]?.readyState)).toBe('ended');
  await page.waitForTimeout(700);
  await expect(page.getByText('Audio đã sẵn sàng')).toHaveCount(0);
  await expect(page.getByText('Đang ghi âm cuộc gọi')).toHaveCount(0);
});

test('optional Sheet mapping can be cleared without crashing the form', async ({ page }) => {
  await page.goto('/__e2e/sheets-admin');
  await expect(page.getByRole('dialog', { name: 'Cấu hình nguồn lead' })).toBeVisible();
  await page.getByLabel('Spreadsheet ID hoặc link').fill('synthetic-spreadsheet-id');
  await page.getByRole('button', { name: 'Đọc cấu trúc Sheet' }).click();
  await expect(page.getByLabel('Cột cho name')).toBeVisible();
  await expect(page.getByLabel('Cột cho legacy_outcome').locator('..')).toContainText('Lead input');
  await expect(page.getByLabel('Cột cho outcome_1').locator('..')).toContainText('Kết quả từ app');
  const nameMapping = page.getByLabel('Cột cho name');
  await expect(nameMapping).toHaveValue('stable-name');
  await nameMapping.selectOption('');
  await expect(nameMapping).toHaveValue('');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows blocked Sheet identity conflicts and only clears after server-confirmed repair', async ({ page }) => {
  await page.goto('/__e2e/sheets-admin');
  await expect(page.getByText(/Xung đột ID lead abcdef12/)).toBeVisible();
  await expect(page.getByText(/máy chủ xác nhận ID duy nhất/)).toBeVisible();
  await page.getByRole('button', { name: 'Đối soát ID an toàn' }).click();
  await expect(page.getByRole('status')).toContainText(/Đã xác minh và gỡ chặn định danh lead abcdef12/);
  await expect(page.getByText(/Xung đột ID lead abcdef12/)).toHaveCount(0);
});

test('refreshes incoming leads on focus without replacing the selected in-progress draft', async ({ page }) => {
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.getByLabel(/Ghi chú cuộc gọi/).fill('Đang trao đổi, giữ lại ghi chú');
  await page.evaluate(() => {
    localStorage.setItem('verified-call-e2e-add-lead-on-list', 'once');
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByRole('button', { name: /Lead mới đồng bộ/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible();
  await expect(page.getByLabel(/Ghi chú cuộc gọi/)).toHaveValue('Đang trao đổi, giữ lại ghi chú');
  await expect(page.getByText('Đang giữ lượt gọi')).toBeVisible();
});

test('renews an expired signed upload target with the same recording identity', async ({ page }) => {
  await page.getByRole('button', { name: /Nguyễn Minh Anh/ }).click();
  await page.getByRole('button', { name: /Bắt đầu gọi/ }).click();
  await page.locator('input[type="file"]').setInputFiles(wavFixture());
  await expect(page.getByText(/Audio đã sẵn sàng/)).toBeVisible();
  await page.getByRole('button', { name: 'Có quan tâm' }).click();
  await page.evaluate(() => localStorage.setItem('verified-call-e2e-fault:expired-upload-target-once', 'once'));
  await page.getByRole('button', { name: /Lưu kết quả/ }).click();
  await expect(page.getByText('Đã lưu kết quả. Sheet sẽ đồng bộ nền.')).toBeVisible();
  const verification = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('verified-call-demo-v1') ?? '{}') as { leads: Array<{ displayName: string; recordings: Array<{ id: string }> }> };
    const lead = state.leads.find((item) => item.displayName === 'Nguyễn Minh Anh');
    return { recordings: lead?.recordings.length, uploadTargetRefreshes: localStorage.getItem('verified-call-e2e-upload-target-refresh-count') };
  });
  expect(verification.recordings).toBe(1);
  expect(verification.uploadTargetRefreshes).toBe('1');
});
