# Dùng thử trên máy này

Bản này dùng Supabase local thật. Cloud và Google Sheet thật chưa kết nối. Mười lead chuẩn bị sẵn đều là dữ liệu giả; không gọi các số mẫu.

1. Mở `http://127.0.0.1:5173` khi hai terminal bên dưới đang chạy.
2. Dùng email admin đã cung cấp trong cuộc trò chuyện. Mật khẩu được tạo ngẫu nhiên và lưu riêng ở `.supabase/local-admin-credentials.json` trong thư mục project. Mở file trên máy để sao chép; không đưa file này vào Git, ticket hay chat.
3. Chọn một lead, bấm **Bắt đầu gọi**, cấp quyền micro và ghi một đoạn thử. Dừng, nghe lại, chọn kết quả rồi lưu. Mỗi kết quả đã lưu tính một lượt, tối đa năm lượt.
4. Với tài khoản thử bổ sung, vào **Thành viên → Mời thành viên**, chọn Admin/Staff/Viewer, tạo và sao chép link. App không gửi email. Link `127.0.0.1` chỉ dùng trên máy này; có thể mở bằng cửa sổ riêng tư để thử tài khoản khác.
5. Viewer chỉ xem lead/lịch sử và nghe các recording links đang active. **Thu hồi quyền truy cập** giữ lịch sử và các link đã bàn giao; cần thao tác thu hồi recording link riêng nếu muốn dừng chia sẻ.

## Khởi động lại

Mở Terminal ở thư mục project. Terminal thứ nhất:

```sh
colima start
npx supabase start -x realtime,imgproxy,studio,logflare,vector,supavisor,postgres-meta
npx supabase migration up --local
npx supabase functions serve --env-file .supabase/functions.env
```

Terminal thứ hai, cũng ở thư mục project:

```sh
npm run dev -- --mode supabase --host 127.0.0.1 --port 5173
```

Giữ nguyên `.supabase/functions.env`, `.env.supabase.local`, credentials và volume database. Không chạy `db reset` khi resume. Không cần chạy lại bootstrap admin hoặc bộ harness tổng thể; harness cố ý từ chối database đã có lead pilot. Script `prepare-local-pilot.mjs` có thể chạy lại mà không reset kết quả của các lead đã tạo.

Nếu chưa vào được app, kiểm tra Colima đang chạy và ổ đĩa còn chỗ trống. Thông tin vận hành chi tiết ở [OPERATIONS.md](OPERATIONS.md); kết quả kiểm chứng ở [PILOT-LOCAL-QC.md](PILOT-LOCAL-QC.md).

## Bước tiếp theo

Thử một lần ghi âm trên máy, kiểm tra Viewer và luồng mời bằng cửa sổ riêng tư. Khi chuyển sang cloud, cần Supabase project còn quota, Cloudflare, email staff, quyền service account trên một Sheet pilot riêng và người thử cuộc gọi hai chiều. Chưa có deployment, Cron hoặc Sheet production nào được bật trong đợt local này.
