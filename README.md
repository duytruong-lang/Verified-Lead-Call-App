# Verified Lead Call App

Ứng dụng một màn hình để nhân viên gọi lead bằng điện thoại thật, ghi âm bằng micro máy tính, lưu kết quả và bàn giao link nghe riêng tư. Dữ liệu nghiệp vụ nằm trong Supabase; Google Sheets nhận kết quả qua hàng đợi đồng bộ nền. Phạm vi sản phẩm và các giới hạn nghiệp vụ nằm trong [docs/PLAN.md](docs/PLAN.md).

## Chạy demo cục bộ

Yêu cầu Node.js 22 và npm.

```sh
npm ci
npm run dev:demo
```

Demo được chọn rõ ràng qua `.env.demo`; dữ liệu lead tổng hợp nằm trong localStorage và audio trong IndexedDB của trình duyệt này. Link nghe demo chỉ dùng được trong cùng browser profile. Demo không kết nối Supabase hoặc Google Sheets và bị tắt trong production build.

## Chạy Supabase local

Chỉ dùng một project local có thể xóa. Việc `db reset` xóa dữ liệu của project local đang chạy; không chạy với project cloud hoặc database chứa dữ liệu cần giữ. Hướng dẫn khởi tạo migrations, Edge Functions, synthetic auth users và khóa local nằm trong [docs/OPERATIONS.md](docs/OPERATIONS.md) và [docs/BACKEND.md](docs/BACKEND.md) sau khi phần backend được tích hợp vào checkout.

Sau khi local stack, migrations và Edge Functions đang chạy, tạo cấu hình frontend bị Git bỏ qua:

```sh
node scripts/prepare-supabase-e2e-env.mjs
npx playwright test --config=playwright.supabase.config.ts
```

Script từ chối URL không phải loopback. Nó đọc test user fixture `.supabase/backend-test-users.json` nhưng không in email/mật khẩu hoặc lưu chúng vào client bundle. Test setup dùng service key chỉ để tạo và dọn lead/audio tổng hợp; các bước trong trình duyệt đăng nhập bằng nhân viên synthetic. Không dùng cấu hình này với project có thật.

## Kiểm tra frontend

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` chạy Chromium với micro giả và dữ liệu demo, không đụng đến Supabase. Luồng Supabase local là opt-in riêng. Không có lệnh nào ở đây xác minh Google Sheets thật, Cloudflare Pages thật, hay việc thu âm hai chiều qua điện thoại vật lý.

## Tài liệu vận hành

- [Hướng dẫn vận hành](docs/OPERATIONS.md)
- [Hướng dẫn frontend](docs/FRONTEND.md)
- [API và shared contracts](docs/API.md)
- [Kế hoạch sản phẩm](docs/PLAN.md)
- [Bản bàn giao](docs/HANDOFF.md)
