# Vận hành pilot

## 1. Chạy demo

```sh
npm ci
npm run dev:demo
```

Demo chỉ dùng dữ liệu tổng hợp trong browser hiện tại. Lead lưu trong localStorage, audio trong IndexedDB; link nghe không thể gửi ra ngoài hoặc mở ở browser khác. Xóa dữ liệu site của demo sẽ xóa bản nháp, lịch sử và audio demo. Demo không phải bản sao của database production.

## 2. Chạy Supabase local an toàn

Chỉ thao tác với project ID `verified-lead-call-local` trong `supabase/config.toml`, chạy trên máy phát triển. Khi tiếp tục project, giữ database và encryption key hiện có, rồi áp dụng migration bổ sung. `supabase db reset --local` xóa database local, gồm users và lead synthetic; không dùng lệnh này để resume. Không reset project cloud.

Trong checkout đã tích hợp backend, dùng hai terminal. Terminal 1 khởi động stack, migrations và Edge Functions:

```sh
npm ci
npx supabase start -x realtime,imgproxy,studio,logflare,vector,supavisor,postgres-meta
npx supabase migration up --local
node scripts/prepare-local-functions-env.mjs
npx supabase functions serve --env-file .supabase/functions.env
```

Lần đầu `supabase start` tạo database và áp dụng migrations; ở các lần sau `migration up --local` chỉ áp dụng phần còn thiếu. Terminal 2 chạy kiểm tra backend; script tạo user/lead synthetic và lưu credentials vào file bị ignore `.supabase/backend-test-users.json` với quyền hạn chế. Không chép file này vào ticket, log, artifact hoặc repo. Sau đó tạo cấu hình frontend riêng và chạy browser test:

```sh
node scripts/local-backend-check.mjs
node scripts/prepare-supabase-e2e-env.mjs
npx playwright test --config=playwright.supabase.config.ts
```

Test cấu hình Supabase tách khỏi demo CI. Nó từ chối URL không phải `localhost`, `127.0.0.1` hoặc `::1`; service role chỉ dùng để tạo lead tổng hợp riêng cho lần test và dọn storage/database sau đó. Luồng browser đăng nhập staff, ghi micro giả, upload, lưu Verified, mở link trong browser context chưa đăng nhập, phát/tải audio rồi thu hồi link. Không chạy test với dữ liệu lead thật.

### Chuẩn bị workspace Supabase local cho pilot thủ công

Chạy harness backend và browser trước khi thêm lead pilot vì harness yêu cầu database chưa có lead, mapping hoặc sync job. Browser test tự dọn invite mà nó tạo; sau đó dọn đúng fixtures do harness ghi trong manifest. Các lệnh chỉ chấp nhận API loopback, không gửi email và không ghi Google Sheet:

```sh
node scripts/cleanup-local-backend-check.mjs
node scripts/bootstrap-local-admin.mjs <email-admin-pilot>
node scripts/prepare-local-pilot.mjs
npm run dev -- --mode supabase --host 127.0.0.1
```

Bootstrap chỉ tạo Admin đầu tiên khi chưa có Admin hoạt động; mật khẩu ngẫu nhiên được lưu trong file ignored `.supabase/local-admin-credentials.json` với quyền đọc hạn chế. Script pilot tạo mười lead synthetic có ID cố định và source marker riêng. Chạy lại không ghi đè lead đã có hoặc call state; xung đột ID/source sẽ dừng để người vận hành kiểm tra. `.env.supabase.local` chỉ chứa mode, URL loopback và anon key; không đưa service-role key vào frontend. Link mời/khôi phục được Admin tự sao chép và gửi qua kênh nội bộ phù hợp; app không gửi email.

## 3. Quy trình nhân viên

1. Đăng nhập bằng tài khoản được cấp, chọn lead và đọc câu trả lời form trước khi gọi.
2. Nhấn **Bắt đầu gọi**, gọi từ điện thoại vật lý ở chế độ loa ngoài, sau đó cấp quyền và ghi âm bằng micro PC. Có thể tải file audio thay thế.
3. Nghe lại, chọn đúng một trong tám kết quả. **Khác** cần ghi chú; không liên lạc được dùng **Thuê bao/máy bận**.
4. Chỉ bật **Đã xác minh** khi audio phát được, upload sẵn sàng và link bàn giao được tạo. **Lưu kết quả & tiếp tục** chốt một lượt gọi rồi mới chuyển lead.
5. Nếu trình duyệt báo kết quả lưu chưa rõ, giữ nguyên form và bấm lưu lại để gửi cùng khóa idempotency. Hoặc hủy lượt một cách chủ ý. Không thay kết quả/audio trong khi app đang chờ phản hồi lưu.

Mỗi lead tối đa năm kết quả đã lưu. Bản ghi lại, upload lại và retry không tạo thêm lượt. Bản nháp đang giữ có lease 15 phút và app gia hạn trong lúc mở. Nếu phiên hết hạn, tải lại lead rồi chọn **Tiếp tục** hoặc **Hủy lượt**.

## 4. Cấu hình Sheet cho admin

Chỉ admin cấu hình một spreadsheet/tab nguồn. Dán link hoặc ID, chọn tab và dòng tiêu đề, rồi đọc cấu trúc. Rà soát từng role theo metadata ID ổn định, đặc biệt cột phone/ID và các cột kết quả. Không ánh xạ cột công thức thành đầu ra. Bấm **Kiểm tra mapping** trước khi lưu.

**Chuẩn bị bản pilot** thêm technical lead-ID header/column và metadata vào Sheet đang chọn. Chỉ xác nhận với bản copy đã được phép sửa. Kiểm tra lại công thức, filter và automation trước khi dùng. Không chạy lệnh admin trên Sheet production khi chưa được chủ Sheet cho phép.

Sheet nhận kết quả bất đồng bộ; database app là hồ sơ chính. Trạng thái **Bị chặn** không tự ghi đè. Admin đọc lỗi, kiểm tra mapping/schema và dùng **Đối soát an toàn** để server reread/so sánh các ô hiện tại. Nút này không ép gửi lại dữ liệu sai khác. Nếu dữ liệu Sheets chưa khớp, giữ trạng thái blocked và chuyển cho người vận hành backend/Sheets.

## 5. Lỗi thường gặp và khôi phục

- **Không xin được microphone:** cấp quyền site, kiểm tra thiết bị đầu vào hoặc tải file audio. Browser cần secure context khi truy cập từ host ngoài localhost.
- **File audio bị từ chối:** kiểm tra phát lại được trong browser, MIME/container, dung lượng dưới 50 MB và thời lượng không quá 30 phút; dùng file khác rồi lưu lại.
- **Upload lỗi hoặc URL hết hạn:** giữ nguyên file và bấm lưu lại. Client tái dùng idempotency key/recording target cho cùng clip; chọn hoặc ghi audio khác tạo bản ghi mới.
- **Kết quả lưu chưa rõ:** app khóa dữ liệu đã gửi và giữ cùng save key. Retry nút lưu; nếu server đã commit, response replay không tăng attempt lần nữa. Nếu không thể khôi phục, ghi lại lỗi và nhờ admin kiểm tra lead trước khi hủy.
- **Claim conflict/lease hết hạn:** tải lại lead; chỉ staff đang giữ claim hoặc admin xử lý được lượt đó. Tiếp tục claim hiện có thay vì mở attempt mới.
- **Link bị thu hồi:** người nhận phải xin link mới từ nhân viên. Link cũ không được tạo signed playback URL mới; signed URL đã cấp trước đó có thể còn hiệu lực đến hết năm phút.
- **Sheet queue blocked:** không chỉnh trực tiếp bảng hoặc bấm force retry. Kiểm tra mapping, phiên bản lead và output cells; dùng reconcile server-side. Call đã lưu trong database không bị mất khi Sheet lỗi.

## 6. Rollout Cloudflare Pages

Đây là hướng dẫn deploy, không phải xác nhận app đã được deploy.

1. Chạy đủ checks trong README và local Supabase browser flow. Pilot bằng Supabase project/Sheet riêng, có admin/staff test accounts và quyền ghi rõ ràng.
2. Cloudflare Pages build command: `npm ci && npm run build`; output directory: `dist`. Không cấu hình service role key trong Pages variables.
3. Thêm `VITE_APP_MODE=supabase`, `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` làm build-time variables của đúng environment. Anon key là client key và vẫn chịu RLS; mọi mutation/role check phải ở server.
4. Triển khai migrations, Edge Functions, Storage policy và worker/cron theo release backend; đặt `PUBLIC_APP_URL` đúng origin của Pages và giữ `SHARE_ENCRYPTION_KEY` bền vững. Không đổi encryption key đã dùng để tạo token.
5. Mở URL Pages, đăng nhập staff thử, tạo bản ghi synthetic có sự cho phép, kiểm tra link/nghe/tải/thu hồi và xác minh Sheets chỉ ghi lên bản pilot copy. Theo dõi job blocked trước khi mời operator.

### Rollback

Cloudflare Pages có thể quay lại deployment frontend trước đó và khôi phục build variables trước thay đổi. Kiểm tra bản frontend cũ tương thích schema/backend đang chạy. Không xóa audio hay sửa DB trực tiếp để rollback UI. Migration đã triển khai cần migration sửa tiếp hoặc khôi phục snapshot database theo kế hoạch backend; không chạy `db reset` trên cloud. Tạm dừng worker/Sheet writes nếu phát hiện mapping sai, giữ dữ liệu call trong PostgreSQL, và chỉ bật lại sau reconcile/kiểm tra pilot.

## Giới hạn bằng chứng

Playwright demo chứng minh luồng local với IndexedDB và fake microphone. Supabase browser test, khi chạy, chỉ chứng minh stack local và synthetic users. Không test nào thay cho xác nhận Google Sheet thật, Cloudflare deployment, bảo mật môi trường production, cuộc gọi vật lý hai chiều, chính sách lưu trữ/retention, hoặc phê duyệt chủ dữ liệu.
