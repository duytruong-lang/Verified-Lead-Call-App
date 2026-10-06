# Bàn giao và nghiệm thu local-first

**Kết luận: chấp nhận phạm vi local-first** trên mã nguồn `2e24bba024975c3488c6b26dd5f67e07cb9e3f47`, ngày 06/10/2026. Sol hoàn tất QC tích hợp tại SHA này; Astra đối chiếu kế hoạch, kiểm tra trải nghiệm và chạy lại luồng Supabase local thành công. Không còn blocker được ghi nhận cho phạm vi này. Đây chưa phải phê duyệt vận hành production hay xác nhận Google Sheets thật.

## Bản bàn giao

- [Repository](https://github.com/duytruong-lang/Verified-Lead-Call-App).
- [PR #3 — backend](https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/3) và [PR #5 — Sheets/tích hợp](https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/5) đã merge. Commit tích hợp trên `main`: `35de0ed61f1a7cee3440d1ced444ff76d6af4ed1`; coordinator xác nhận cây mã nguồn không có diff so với SHA được kiểm tra `2e24bba024975c3488c6b26dd5f67e07cb9e3f47`. Bản bàn giao này được xuất bản bằng thay đổi tài liệu riêng sau nghiệm thu.
- [Demo đang chạy trên máy phát triển](http://127.0.0.1:5174). URL chỉ hoạt động khi dev server còn chạy; không phải website đã deploy. Demo dùng dữ liệu tổng hợp, lưu lead/audio trong browser hiện tại; link demo không thể bàn giao cho người ngoài hoặc browser profile khác.
- Supabase local dùng API `http://127.0.0.1:54321`, project `verified-lead-call-local`. Test tích hợp khởi động frontend tại `http://127.0.0.1:5173` trong thời gian chạy. Không có tài khoản cloud hoặc Sheet thật được kết nối trong lần nghiệm thu này.

Luna phụ trách implementation/fixes; Sol review và QC độc lập; Astra nghiệm thu và bàn giao; coordinator phụ trách tích hợp/release. Người sở hữu môi trường cloud, bản Sheet pilot và vận hành production sẽ được chỉ định khi mở giai đoạn đó.

## Phạm vi đã hoàn thành

Workspace tiếng Việt gồm bốn hàng đợi, thông tin form, giữ/tiếp tục/hủy lượt, ghi âm microphone hoặc tải audio, tám kết quả, ghi chú, lịch sử và đánh giá cuối. App chọn demo hoặc Supabase rõ ràng; không tự chuyển sang demo khi backend lỗi.

PostgreSQL giữ hồ sơ nghiệp vụ; Auth, private Storage và Edge Functions xử lý quyền, upload/kiểm tra audio, chia sẻ, thu hồi và idempotency. Link nghe gắn cố định với một recording; thay recording bàn giao là thao tác có phiên bản và audit. Trang công khai chỉ chứa thông tin recording, phát/tải bằng signed URL năm phút.

Adapter Sheets gồm cấu hình admin, mapping theo metadata, UUID độc lập với số điện thoại, import lịch sử, durable outbox, phiên bản/fencing, retry có giới hạn và đối soát write chưa rõ kết quả. Phần này được kiểm tra bằng dữ liệu tổng hợp và Google HTTP giả lập, chưa ghi lên Google Sheets thật.

## Bằng chứng nghiệm thu

Phân biệt kiểm tra do Sol báo cáo ở gate cuối với kiểm tra Astra trực tiếp chạy. Không suy rộng bằng chứng local sang cloud.

| Tiêu chí | Bằng chứng và kết quả | Giới hạn |
| --- | --- | --- |
| Nền tảng build | Sol: typecheck, lint, build và 45 unit tests đạt tại SHA đã chốt. | Build chỉ chứng minh biên dịch, chưa xác nhận deployment Cloudflare/production. |
| Frontend nghiệp vụ | Sol: 11 Playwright demo tests đạt, gồm upload/ghi micro giả, lưu, note bắt buộc cho `other`, audio không phát được, chặn lượt sáu, retry cùng key, thay clip sau lỗi share, hủy recording, mapping/identity conflict, refresh lead và gia hạn upload URL. | Demo/IndexedDB, không chứng minh backend hay thiết bị thật. |
| Backend thật trên máy | Sol: harness chạy qua local Auth/PostgreSQL RPC/private Storage/Edge Functions đạt; kiểm tra quyền, tranh claim, validation audio, replay/idempotency, handoff history và revoke. | Supabase loopback, dữ liệu synthetic; chưa kiểm chứng cấu hình cloud. |
| Nhân viên → người nhận | Astra trực tiếp chạy `npx playwright test --config=playwright.supabase.config.ts`: **1/1 đạt**, 5,6 giây. Staff đăng nhập, micro giả → upload private → lưu Verified; browser context không đăng nhập phát audio có thời gian tiến, tải file không rỗng; context mới bị từ chối sau thu hồi. Test dọn lead/audio riêng của lần chạy. Sol cũng đã chạy thành công luồng này ở gate cuối. | Có bằng chứng playback thực trong browser; không chứng minh chất lượng thu thoại vật lý hai chiều. Signed URL đã cấp có thể tồn tại đến hết năm phút. |
| Trải nghiệm nhân viên | Astra đọc giao diện và quan sát bố cục demo: banner local rõ, bốn hàng đợi, số lượt 0–5, thông tin form, nút bắt đầu gọi và lịch sử hiển thị trực tiếp. Đối chiếu hướng dẫn operator với luồng browser đã chạy. | Quan sát desktop; không phải nghiên cứu người dùng hoặc kiểm thử mọi thiết bị. |
| Admin và quyền Sheets | Sol: admin status/UI hiển thị identity conflict dạng chuỗi, không lỗi React; staff bị 403, anonymous bị 401 trên local Edge. | Không dùng Google account thật. |
| Chống ghi nhầm Sheet | Sol: unit/fake Google HTTP và kiểm tra đối kháng UUID A/B độc lập đạt; UUID đổi bị chặn với **0 writes**. Mapping/formula, duplicate IDs, sort/row metadata, stale version, retry và reconciliation được kiểm tra bằng fake transport. | Luồng save → outbox → ghi Google Sheet thật vẫn chưa được nghiệm thu. |
| Khả năng phục hồi dependency | Sol: frozen Deno checks đạt cho cả bốn Edge entrypoints tại lockfile cuối. | Chưa xác nhận deploy lên Supabase cloud. |

Giới hạn năm kết quả chỉ tăng khi lưu kết quả mới; retry/upload/ghi lại không tăng lượt. Verified cần audio ready, phát được, thuộc lead và share active. Các ràng buộc này nằm trong shared rules, transaction backend và kiểm tra trên. Giới hạn audio là 30 phút hoặc 50 MB; việc chặn metadata/file lỗi trên server không thay thế nghe thử chất lượng âm thanh thực tế.

## Bắt đầu sử dụng local

### Demo cho người xem

1. Trong checkout đã tích hợp, chạy `npm ci` rồi `npm run dev:demo -- --host 127.0.0.1 --port 5174`.
2. Mở URL được terminal hiển thị. Kiểm tra banner **DEMO · CHỈ TRÊN MÁY NÀY** trước khi thao tác.
3. Chọn lead synthetic → **Bắt đầu gọi** → ghi âm hoặc chọn file → chọn kết quả → **Lưu kết quả & tiếp tục**. **Khác** cần ghi chú; không liên lạc được dùng **Thuê bao/máy bận**.
4. Với bàn giao, nghe lại audio rồi chọn **Đã xác minh**. Link demo chỉ dùng trong cùng browser profile. Không đưa dữ liệu khách hàng thật vào demo.

### Kiểm tra stack Supabase local

Theo [OPERATIONS.md — chạy Supabase local và xử lý lỗi](OPERATIONS.md) và [BACKEND.md — migrations, Auth, Storage, shares](BACKEND.md). Môi trường nghiệm thu hiện đang chạy; không chạy lại `db reset` chỉ để mở app vì lệnh này xóa users/lead/audio metadata local.

Khi stack/Edge đã sẵn sàng, cấu hình browser test bằng `node scripts/prepare-supabase-e2e-env.mjs`, rồi chạy `npx playwright test --config=playwright.supabase.config.ts`. Test chỉ cho phép loopback, tạo lead synthetic riêng và dọn sau khi chạy. Credentials trong file ignored `.supabase/backend-test-users.json` là dữ liệu riêng tư của máy, không chép vào Git, ticket hay tài liệu bàn giao. Giữ `SHARE_ENCRYPTION_KEY` bền vững để link đã tạo tiếp tục được khôi phục.

### Nhân viên và admin

- Quy trình nhân viên, retry khi kết quả lưu chưa rõ, claim hết hạn, upload lỗi và thu hồi link: [OPERATIONS.md, mục 3 và 5](OPERATIONS.md).
- Mapping/admin, schema drift, identity repair, giữ formula/unmapped columns và blocked jobs: [SHEETS.md](SHEETS.md) và [OPERATIONS.md, mục 4](OPERATIONS.md).
- Khởi tạo tài khoản/role và private Storage: [BACKEND.md](BACKEND.md). Demo không chứng minh phân quyền; dùng stack local để kiểm tra Auth/role.
- Shared contract, mã outcome, version và idempotency: [API.md](API.md). Phạm vi và acceptance criteria gốc: [PLAN.md](PLAN.md).

Khi lưu chưa rõ, giữ nguyên dữ liệu đã gửi và retry cùng lượt; không tạo lượt mới để thay thế. Khi Sheet bị blocked, dữ liệu call vẫn nằm trong database; admin đối soát theo snapshot hiện tại, không force retry một write chưa rõ kết quả. Link cũ tiếp tục gắn với recording cũ khi thay handoff; thu hồi link là thao tác riêng.

## Rollback và bước mở pilot thật

Hướng dẫn rollback nằm ở [OPERATIONS.md — Rollback](OPERATIONS.md). Với local, dừng dev server và quay lại commit đã biết tốt; giữ database và encryption key nếu cần giữ dữ liệu. Frontend cũ phải tương thích backend/schema hiện hành. Không dùng reset database để rollback UI. Khi phát hiện mapping sai, dừng worker/Sheet writes, giữ PostgreSQL và reconcile trước khi bật lại.

Các mục sau còn **chưa kiểm chứng/chưa được triển khai** và cần một pilot được cho phép riêng:

1. Supabase cloud, cấu hình Auth/Storage/Edge/secrets và Cloudflare Pages trên URL thật; chưa có production URL.
2. Service account Google, quyền truy cập và vòng đầy đủ import → save → async output trên **bản copy Sheet đã được cho phép**; kiểm tra formula, sort/insert, duplicate phone và chuyển lookup sang app UUID trên bản copy.
3. Supabase Cron khoảng mỗi 60 giây, phục hồi sau restart/network lỗi, theo dõi outbox/blocked jobs trong môi trường thật.
4. Một nhân viên gọi bằng điện thoại loa ngoài với micro PC thực: nghe được cả hai phía, âm lượng/echo/nhiễu chấp nhận được, browser vẫn mở và máy không ngủ trong lúc ghi/upload.
5. Chủ vận hành, quota/cost, backup, retention và quy trình xử lý sự cố trước khi đưa dữ liệu thật vào hệ thống.

Bước kế tiếp là pilot có một nhân viên và một bản Sheet copy sau khi có tài khoản, quyền và chủ môi trường rõ ràng. Không cần hoàn thành các mục cloud để dùng bản demo/local đã nghiệm thu.
