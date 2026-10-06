# UI 1990, Auth và phân quyền — nghiệm thu local

Ngày kiểm chứng: 06/10/2026 (Asia/Ho_Chi_Minh). Nhánh `codex/pilot-ui-access`, PR [#7](https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/7). Đây là bằng chứng cho Supabase **local**, chưa phải cloud pilot.

## Phạm vi

React/Vite/TypeScript/Tailwind 4 được giữ lại; shadcn/Radix primitives tại `src/components/ui`, alias `@/*`, Montserrat và token trắng–đen–đỏ 1990. Đỏ thương hiệu `#EC2024`; các nút chữ trắng cỡ nhỏ dùng action red `#c9161a` (contrast xấp xỉ 5.81:1), thay cho 4.38:1 của đỏ thương hiệu với trắng. Sign-in tiếng Việt, hiển thị mật khẩu, loading/disabled/focus và reduced motion.

Email/password dùng Supabase Auth thật; admin tạo link mời/khôi phục thủ công, không gửi email. Pending và disabled không vào workspace. Role/status do database quyết định; Viewer chỉ đọc. Thu hồi quyền/hạ Staff thành Viewer hủy draft mà không tăng lượt và chặn upload/save đến muộn. Giữ recording links đã bàn giao. Admin cuối, tự hạ quyền, stale versions, retry và Auth identity binding đều được kiểm soát server-side.

## Bằng chứng đã chạy

| Kiểm tra | Kết quả | Môi trường / giới hạn |
| --- | --- | --- |
| `npm run typecheck`, `npm run lint` | Pass | Source tích hợp |
| `npm test` | 46/46 pass | 8 files; Vitest |
| `npm run build` | Pass | Có cảnh báo bundle JS khoảng 819 kB; chưa tối ưu code splitting |
| Deno frozen check | 5/5 Edge entrypoints pass | Không thay lockfile khi check |
| Deno helper tests | 4/4 pass | Sol tự chạy crypto/link helpers |
| `node scripts/local-backend-check.mjs` | 117 assertions pass | Supabase Auth/PostgreSQL/RLS/Storage/Edge thật trên loopback; synthetic fixtures |
| `npm run test:e2e` | 17/17 pass | Demo; fake microphone, responsive và fonts đã load |
| Supabase Playwright | 4/4 pass (19,4 giây) | Auth/invite/recovery và recording thật trên stack local |

Backend harness kiểm tra anonymous/pending/disabled/Viewer, tự nâng role trực tiếp, RPC/service finalizer, older-unconfirmed Auth identity, email chuẩn hóa/không trùng, retry cùng link, link hết hạn/bị thay thế và cấp mới, mời/đặt mật khẩu/đăng nhập, thu hồi giữa claim/upload/save, stale versions, thay đổi Admin đồng thời, mapping bị thu hồi quyền, năm lượt gọi, audio hợp lệ, public playback/revoke và Sheet outbox fencing. Các thao tác Sheet trong harness là dữ liệu database giả, không gọi Sheet thật.

Demo browser kiểm tra 320/375/414/768px và desktop, không tràn ngang; mobile quay lại hàng đợi; font Montserrat được load trước chụp ảnh; keyboard password toggle; lỗi auth callback; invite/retry UI; recording/Verified/playback; uncertain save và upload renewal. Ảnh demo không phải bằng chứng cloud.

Supabase browser kiểm tra mời mới → reload bước đặt mật khẩu → đăng nhập; recovery → reload → mật khẩu mới; đổi role và vô hiệu hóa; Viewer chỉ đọc; Auth 503 dừng micro, giữ audio và khóa thao tác cho đến khi phục hồi; ghi âm → Verified → playback/download ở context anonymous → revoke. Dữ liệu lead dành riêng cho test được đăng ký trước khi tạo và cleanup trong `finally`. Worktree test có cảnh báo font vì symlink dependencies; bằng chứng visual/font dựa trên bộ demo chạy từ checkout có dependencies riêng.

## Review

Luna triển khai. Sol review độc lập các guards/transactions/Auth/session/cleanup và chạy helper checks. Các findings đã dẫn tới sửa race lưu mapping, stale UI async completion, phân biệt lỗi mạng với mất quyền, expired-link idempotency, binding Auth khi cấp lại invite và phục hồi manifest khi test lỗi. Astra review phạm vi nghiệm thu, yêu cầu regression reload bước đặt mật khẩu và kiểm tra lại ảnh mobile.

Astra chấp nhận phạm vi local tại `a02871fe65e699bc2926c18bbeb45bd979a6eeba`, sau Sol delta QC tại `c9bb1dd`. `src/` và `supabase/` không đổi giữa hai SHA; khác biệt cuối là fixtures/locators E2E. Không còn blocker ứng dụng được ghi nhận.

Admin local đã được bootstrap bằng email user cung cấp; password được tạo ngẫu nhiên trong file ignored `0600`. Mười lead synthetic đã được chuẩn bị. Chạy seed lần hai: 0 insert, 10 giữ nguyên, chứng minh không reset trạng thái. Các fixture Auth/profile test cũ được vô hiệu hóa, giữ attribution/audit.

## Vận hành và phạm vi chưa kiểm chứng

Xem [OPERATIONS.md](OPERATIONS.md) để khởi động stack, chạy bộ test trước khi nạp pilot, dọn đúng fixtures và tạo local admin/10 lead giả. Không dùng `db reset` khi resume. Giữ encryption keys, database và file credentials bị ignore; không đưa service role vào frontend.

Cloud Supabase/Cloudflare, Google Sheet thật/Cron, service account và cuộc gọi vật lý hai chiều **chưa chạy**. User đã chọn local trước. Audio test dùng microphone giả/file tổng hợp; operator vẫn cần thử điện thoại loa ngoài và micro PC. Free cloud quota chưa được giải quyết.

## Post-persistence operator smoke

Sau khi lưu source về thư mục project gốc và mở lại Colima/Supabase mà không reset database, browser smoke đăng nhập bằng admin đã provision, xác nhận đủ 10 lead giả, nút quản lý thành viên, Montserrat thực sự tải trên bản Supabase local, rồi đăng xuất: **pass**. Không đổi dữ liệu lead. Bước này xác nhận cả runtime và font từ thư mục bàn giao, bổ sung cho cảnh báo symlink của worktree test trước đó.
