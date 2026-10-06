# Frontend operator guide

## Run locally

Use `npm run dev:demo` to open the synthetic local workspace. Demo mode is selected explicitly by `.env.demo`; it never connects to Supabase or Google Sheets. Demo lead details stay in this browser's local storage and audio Blobs stay in IndexedDB. Demo recording links work only in the same browser profile and are labeled local-only.

For the local Supabase app, configure `VITE_APP_MODE=supabase`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Members sign in with Supabase Auth. Invitation and recovery callbacks use `/auth/confirm?token_hash=…&type=invite|recovery`, then ask the member to set a password. The URL is cleared after callback handling; reloading the setup page uses the persisted Auth session. A missing or invalid mode stops startup; a live request failure never switches to demo.

Admins can open **Thành viên** when no call draft or recording is active. The team view lists pending, active, and disabled members. Role changes take effect only after the server confirms them. Disabling access requires confirmation and preserves member history. Admins can issue a fresh invite or recovery link; the one-use link is shown temporarily in the open panel for manual delivery. The app does not send the link through email. Demo mode uses synthetic member records and local-only links; it does not invite real accounts.

The **Chỉ xem** role can read lead details, call history, and active handoff links. It cannot claim a call, record/upload audio, save an outcome, change an evaluation, replace a handoff, revoke a share, or open admin settings. The app refreshes role and account status on window focus, Auth events and a visible-page poll. Confirmed loss of write access stops the microphone and clears the unsaved call composer. A temporary Auth/network outage stops capture and pauses mutations while retaining the unsaved audio/form until access can be rechecked.

## Call a lead

1. Select a lead and review its form answers and previous calls.
2. Choose **Bắt đầu gọi**, call from a physical phone on speaker, and record from the computer microphone. The browser asks for microphone access. Use **Tải audio** if a prepared recording is needed.
3. Stop or preview the audio, choose one outcome, add an optional note (required for **Khác**), then choose **Lưu kết quả & tiếp tục**.
4. Check **Đã xác minh** only when a playable recording is ready to hand off. The app uploads and validates audio before it saves the contact result. If the server rejects audio, replace or remove it before saving.

Audio must play in the browser and stay within 30 minutes and 50 MB. Contact attempts increase only after a saved outcome; a lead cannot exceed five. A saved call moves to the next lead in the selected queue. Reloading during an unfinished claim shows resume and cancel controls. Leaving an active call or unsaved recording asks before canceling it.

The handoff link is shown after a verified save. Each link remains pinned to its recording. To change the current handoff, choose another ready recording under **Bản ghi âm** and confirm the replacement. Old links retain their original audio; an owner or admin can revoke a link. The public `/r/:token` page shows a recording code, timestamp, duration, player, and download control, without lead fields.

## Configure Sheets

Only admins see **Cấu hình Sheet**. Paste a spreadsheet URL or ID, select its tab and header row, discover columns, map the supported lead and result fields, then validate before saving. The app identifies columns by stable metadata, shows duplicate or ambiguous roles, and disables output mapping to formula cells.

**Chuẩn bị bản pilot** adds the system lead ID header and column metadata to the selected Sheet. It asks for confirmation and should only be used for an authorized pilot copy. Mapping validation errors stop output writes while the app retains saved call state. The admin view shows mapping status and blocked sync jobs; **Đối soát an toàn** rereads and compares the current mapped cells and does not force a retry.

## Frontend verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`. The default browser suite uses demo leads/audio and Chromium's fake microphone. The opt-in `npx playwright test --config=playwright.supabase.config.ts` suite uses actual loopback Supabase Auth/DB/Storage/Edge with separately tracked synthetic fixtures. Neither suite verifies cloud hosting, a real Google Sheet, or physical phone audio. See `docs/PILOT-LOCAL-QC.md` for the recorded environment-specific results.
