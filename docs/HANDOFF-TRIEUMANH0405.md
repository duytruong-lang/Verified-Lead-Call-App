# Hướng dẫn bàn giao cho trieumanh0405

Làm theo tài liệu này để tạo Supabase cloud **do trieumanh0405 sở hữu**. Bản local hiện tại chỉ được kiểm tra với dữ liệu tổng hợp; chưa triển khai hay xác minh cloud, Google Sheet thật hoặc Cloudflare Pages thật. Tài liệu GitHub không chuyển giao database local, tài khoản Auth, khóa mã hóa, file ghi âm, credentials hoặc cấu hình riêng trên máy.

## 1. Nhận source code

1. Chấp nhận lời mời GitHub đang chờ với quyền `write`.
2. Sau khi PR bàn giao đã merge, clone `main` và cài dependencies bằng lockfile:

   ```sh
   git clone https://github.com/duytruong-lang/Verified-Lead-Call-App.git
   cd Verified-Lead-Call-App
   git switch main
   npm ci
   ```

3. Máy cần Node.js 22. Kiểm tra checkout có đủ 11 file trong `supabase/migrations/`, năm Edge Functions liệt kê bên dưới và tài liệu này. Chế độ demo không kết nối project live.

## 2. Tạo Supabase project của bạn

1. Đăng nhập Supabase bằng tài khoản của trieumanh0405 và tạo project mới trong organization của bạn. Chọn gói Free và region Singapore nếu còn khả dụng; không mua hoặc nâng cấp gói cho bước bàn giao này. Tự đặt database password, lưu trong password manager của bạn.
2. Lấy **Project Ref** và Project URL từ Dashboard. Trước mọi lệnh ghi lên remote, đối chiếu project đã link với đúng Project Ref đó.
3. Dùng Supabase CLI. Xem help trước để xác nhận cú pháp CLI hiện tại, rồi đăng nhập và link đúng ref:

   ```sh
   npx supabase --help
   npx supabase db --help
   npx supabase functions --help
   npx supabase projects list
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase migration list
   ```

   Lệnh `link` chỉ lưu liên kết CLI tới project; nó chưa triển khai ứng dụng. Nếu project ref không trùng project vừa tạo trong Dashboard thì dừng, link lại cho đúng. Không dùng bất kỳ database password, API key hay encryption key nào của máy local.

## 3. Áp dụng database migrations

Repository có 11 migrations theo thứ tự. Trên project mới, xem danh sách migration local/remote, rồi áp dụng các migration đang chờ:

```sh
npx supabase db push
npx supabase migration list
```

`db push` thay đổi database cloud. Chỉ chạy sau khi đã xác nhận project ref và rà soát migration pending. Không chạy `db reset` trên cloud, không tạo tay các bảng trùng với migrations trong Dashboard. Nếu CLI báo lệch migration history hoặc database đã có object, dừng để kiểm tra; không sửa trạng thái migration một cách đoán mò.

## 4. Cấu hình Supabase Auth và Edge Function secrets

### Auth

Trong **Authentication → Sign In / Providers** và **URL Configuration**:

- Tắt **Allow new users to sign up**. Admin sẽ mời thành viên qua app.
- Bật xác nhận email; tắt anonymous sign-ins.
- Đặt **Site URL** thành origin HTTPS chính xác của app Cloudflare Pages.
- Thêm origin production và callback chính xác `https://YOUR_APP_ORIGIN/auth/confirm` vào redirect allow-list. Chỉ thêm preview URL khi bạn chủ động dùng môi trường preview; tránh wildcard rộng cho production.
- Đặt email OTP expiry bằng `3600` giây. Giá trị này phải bằng `TEAM_LINK_TTL_SECONDS` ở phần secrets dưới đây để hết hạn và retry link mời/khôi phục đồng bộ.

`supabase/config.toml` hiện chỉ cấu hình localhost cho local và tắt signup; các giá trị này **không** tự áp dụng sang cloud. Site URL và redirect allow-list cần cấu hình trong Dashboard cloud. Đọc thêm hướng dẫn chính thức về [Auth settings](https://supabase.com/docs/guides/auth/general-configuration), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) và [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

### Edge Function secrets

Tạo riêng hai chuỗi ngẫu nhiên an toàn, mỗi chuỗi có entropy ít nhất 32 byte, lưu trong password manager của organization và đặt làm **Supabase Edge Function secrets** trong project mới:

- `PUBLIC_APP_URL`: origin Pages; dùng để tạo link bản ghi và link mời/khôi phục.
- `APP_ORIGIN`: cùng origin Pages; dùng cho CORS.
- `PUBLIC_SUPABASE_URL`: URL HTTPS của project này, dạng `https://YOUR_PROJECT_REF.supabase.co`.
- `SHARE_ENCRYPTION_KEY`: secret ngẫu nhiên thứ nhất; giữ ổn định vì token share phụ thuộc khóa này.
- `TEAM_LINK_ENCRYPTION_KEY`: secret ngẫu nhiên thứ hai, khác hoàn toàn khóa trên; giữ ổn định khi còn link thành viên được mã hóa.
- `TEAM_LINK_TTL_SECONDS=3600`: phải bằng email OTP expiry trong Auth.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: tùy chọn. Để trống cho tới khi chủ dữ liệu cho phép một Sheet pilot riêng, service account được tạo riêng và chỉ được cấp quyền trên bản copy đó.

Tạo file secrets cá nhân từ [`supabase/functions/secrets.example`](../supabase/functions/secrets.example), lưu tại vị trí bị Git ignore và đặt quyền đọc riêng:

```sh
mkdir -p .supabase
cp supabase/functions/secrets.example .supabase/cloud-secrets.env
chmod 600 .supabase/cloud-secrets.env
```

Mở `.supabase/cloud-secrets.env`, thay toàn bộ placeholder bằng origin/project ref và hai khóa mới của bạn. Để nguyên `GOOGLE_SERVICE_ACCOUNT_JSON` ở dạng comment khi Sheets chưa được duyệt. File `.supabase/` đã bị Git ignore. Kiểm tra lệnh CLI hiện tại trước khi upload, sau đó gửi secrets custom lên đúng project:

```sh
npx supabase secrets set --help
npx supabase secrets set --env-file .supabase/cloud-secrets.env
```

Không commit file `.supabase/cloud-secrets.env`, không điền giá trị thật vào `.example`, và không sao chép `.supabase/functions.env` từ local pilot. Supabase tự cấp cho Edge Functions các biến `SUPABASE_URL`, `SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY`; prefix `SUPABASE_` dành riêng cho nền tảng, không tạo custom secret có prefix này. Tuyệt đối không đặt service role/secret key vào Cloudflare Pages hoặc biến trình duyệt. Tham khảo [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

### Deploy năm Edge Functions

Khi migrations và secrets đã sẵn sàng, deploy từ thư mục repository:

```sh
npx supabase functions deploy call-api
npx supabase functions deploy public-recording
npx supabase functions deploy team-admin
npx supabase functions deploy sheets-admin
npx supabase functions deploy sheets-worker
```

`supabase/config.toml` bật xác thực JWT cho bốn function dùng nội bộ và chỉ tắt JWT cho `public-recording`, vốn nhận share token công khai. CLI đọc cấu hình này khi deploy. Xem `npx supabase functions deploy --help` trước khi dùng thêm cờ. Deploy `sheets-admin`/`sheets-worker` không tự kết nối Sheet hoặc bật lịch polling.

## 5. Tạo Admin đầu tiên an toàn

1. Trong Auth Dashboard của project này, tạo Auth user đầu tiên bằng email Admin mà trieumanh0405 kiểm soát. Xác nhận email đó đã được verified/confirmed. Không bật signup công khai để tạo user. Chưa chạy SQL nếu Auth chưa có đúng một user đã xác nhận với email đó.
2. Mở SQL Editor của đúng project. Thay `admin@example.com` và `First Admin` trong transaction dưới đây bằng email đã xác nhận và tên hiển thị. Transaction chỉ tạo quyền Admin khi chưa có membership nào, chỉ thành công khi Auth identity khớp chính xác, và chạy lại an toàn nếu hai bản ghi đã nhất quán.

   ```sql
   begin;
   lock table public.profiles, public.team_members in share row exclusive mode;

   do $bootstrap$
   declare
     target_email text := lower(btrim('admin@example.com'));
     target_name text := 'First Admin';
     auth_id uuid;
     email_confirmed timestamptz;
     auth_matches integer;
     profile_role public.actor_role;
     profile_status public.member_status;
     profile_email text;
     member_auth_id uuid;
     member_role public.actor_role;
     member_status public.member_status;
     member_email text;
     profile_exists boolean;
     member_exists boolean;
   begin
     if target_email = '' or target_email = 'admin@example.com' then
       raise exception 'Replace the SQL placeholder with the verified Admin email';
     end if;

     select count(*) into auth_matches
       from auth.users u where lower(btrim(u.email)) = target_email;
     if auth_matches <> 1 then
       raise exception 'No single Auth user matches the requested email';
     end if;

     select u.id, u.email_confirmed_at
       into auth_id, email_confirmed
       from auth.users u
       where lower(btrim(u.email)) = target_email;
     if auth_id is null or email_confirmed is null then
       raise exception 'The matching Auth user must have a confirmed email';
     end if;

     select p.role, p.status, p.email
       into profile_role, profile_status, profile_email
       from public.profiles p where p.user_id = auth_id;
     profile_exists := found;

     select m.auth_user_id, m.role, m.status, m.email
       into member_auth_id, member_role, member_status, member_email
       from public.team_members m where m.normalized_email = target_email;
     member_exists := found;

     if profile_exists and member_exists then
       if member_auth_id = auth_id
          and profile_role = 'admin' and member_role = 'admin'
          and profile_status = 'active' and member_status = 'active'
          and lower(btrim(profile_email)) = target_email
          and lower(btrim(member_email)) = target_email then
         raise notice 'Matching active Admin already exists; no changes made';
       else
         raise exception 'Existing profile and team membership disagree; inspect them manually';
       end if;
     elsif profile_exists or member_exists then
       raise exception 'Only one membership row exists; inspect it manually before proceeding';
     elsif exists (
       select 1 from public.profiles p
       where p.role = 'admin' and p.status = 'active'
     ) or exists (
       select 1 from public.team_members m
       where m.role = 'admin' and m.status = 'active'
     ) then
       raise exception 'An active Admin already exists; use the app to manage membership';
     else
       insert into public.profiles(user_id, role, display_name, status, email, activated_at)
         values (auth_id, 'admin', target_name, 'active', target_email, now());

       insert into public.team_members(
         auth_user_id, email, normalized_email, display_name,
         role, status, activated_at
       ) values (
         auth_id, target_email, target_email, target_name,
         'admin', 'active', now()
       );
     end if;
   end
   $bootstrap$;

   commit;
   ```

   Nếu xảy ra lỗi, transaction bị rollback. Không bỏ các điều kiện bảo vệ hoặc tự sửa role khi hai bảng lệch nhau; hãy kiểm tra Auth UUID/email cùng cả hai membership trước. Lệnh này tạo đồng thời row trong `profiles` và `team_members`, không tạo Auth user. Script [`bootstrap-local-admin.mjs`](../scripts/bootstrap-local-admin.mjs) vẫn chỉ dành cho máy local và giữ nguyên loopback guard.

3. Đăng nhập app bằng Admin này. Mời Staff/Viewer từ **Thành viên**. Link mời/khôi phục là thông tin dùng một lần; gửi riêng cho đúng người qua kênh đã được chấp thuận. App không tự gửi email.

## 6. Cấu hình Cloudflare Pages

Tạo Pages project từ repository sau khi PR bàn giao đã merge. Cấu hình:

- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Build variables production: `VITE_APP_MODE=supabase`, `VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co`, `VITE_SUPABASE_ANON_KEY=YOUR_PROJECT_PUBLISHABLE_OR_ANON_KEY`

Tên biến `VITE_SUPABASE_ANON_KEY` là tên app đang đọc. Giá trị phải là client publishable/anon key của project này. Không dùng service-role key hoặc secret API key trong Pages. Origin HTTPS phải khớp ở Pages, Auth Site URL/redirect allow-list, `PUBLIC_APP_URL` và `APP_ORIGIN`. Chỉ thêm preview origin nếu bạn chủ động sử dụng môi trường đó.

Kiểm tra cấu hình Pages trỏ tới URL/key project mới, không lấy từ file local. SPA fallback đã nằm trong `public/_redirects`; kiểm tra callback `/auth/confirm` tải được sau khi deploy.

## 7. Để Google Sheets và Cron ở trạng thái tắt

Mặc định không cấu hình Sheet. Không thêm `GOOGLE_SERVICE_ACCOUNT_JSON`, không tạo lịch Cron và không chạy **Chuẩn bị bản pilot** cho đến khi chủ dữ liệu cho phép riêng một bản sao Sheet pilot và service account chỉ có quyền trên bản sao đó. Khi có phê duyệt, làm theo [docs/SHEETS.md](SHEETS.md). SQL Cron hiện có đọc URL/credential từ Supabase Vault; chỉ áp dụng khi đã được phép cấu hình Sheet pilot.

## 8. Smoke test cloud bằng dữ liệu tổng hợp

Ghi lại kết quả kèm đúng project ref và URL deployment Pages. Local mock/CI không phải bằng chứng cloud.

Để kiểm tra ghi âm khi Sheets vẫn tắt, chỉ trên project cloud mới, hãy thêm một lead giả không chứa thông tin khách hàng bằng SQL Editor. Chạy lại câu lệnh không tạo thêm lead trùng:

```sql
insert into public.leads (phone, display_name, source, form_answers, notes)
select '+10000000000', 'Lead kiểm thử', 'synthetic-cloud-smoke',
       '{"purpose":"synthetic test only"}'::jsonb, 'Dữ liệu giả để kiểm tra cloud'
where not exists (
  select 1 from public.leads
  where source = 'synthetic-cloud-smoke' and phone = '+10000000000'
);

select id, phone, display_name, source
from public.leads
where source = 'synthetic-cloud-smoke' and phone = '+10000000000';
```

Chỉ chạy đoạn SQL này trên project test mới do bạn sở hữu, không chạy trong database đang có dữ liệu thật. Không tắt hoặc nới lỏng loopback guard của các script local để seed cloud.

Sau đó thực hiện checklist:

1. Xác nhận Pages tải Montserrat và logo 1990 Agency; kiểm tra không tràn ngang ở 320, 375, 414, 768px và desktop.
2. Xác nhận visitor bất kỳ không tự tạo tài khoản. Admin đăng nhập được và thấy mục quản lý thành viên.
3. Admin mời một Staff và một Viewer bằng email kiểm thử. Mở từng link một lần tại callback production, đặt mật khẩu và đăng nhập. Staff thao tác được, Viewer chỉ xem được. Identity chưa được mời bị từ chối; member bị disable mất quyền nghiệp vụ.
4. Thử link recovery, đặt mật khẩu mới, đăng nhập lại; xác nhận link đã hết hạn hoặc bị thay thế không dùng lại được.
5. Dùng lead giả ở trên và audio kiểm thử ngắn, không chứa hội thoại khách hàng. Kiểm tra quyền microphone, nghe lại, lưu kết quả chưa xác minh và lịch sử/lượt gọi. Sau đó tạo bản ghi phát được, đánh dấu xác minh, mở `/r/<token>` trong browser đã đăng xuất, kiểm tra playback/download và xác nhận không có lead profile trong trang công khai. Thu hồi share và xác nhận không thể xin URL phát mới.
6. Kiểm tra browser chỉ gọi URL Supabase mới và build không chứa service-role/secret key. Pages chỉ có ba biến client đã nêu ở bước 6.
7. Giữ Sheets/Cron tắt trừ khi đã được phê duyệt và cấu hình riêng. Chỉ ghi cloud auth/recording/playback là đã xác minh sau khi các test thủ công trên project thật đạt.

Tài liệu nhà cung cấp hiện tại: [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Edge Functions deploy](https://supabase.com/docs/guides/functions/quickstart), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).
