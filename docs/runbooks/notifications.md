# Thông báo: email, Zalo, xử lý gửi lỗi

Thiết kế: spec 003, ADR-0006. Thông báo trong app luôn chạy; email và Zalo là kênh thêm, bật bằng cấu hình trong
`infra/.env` (api và worker dùng chung tệp này).

## Bật email

1. Lấy thông tin SMTP của khách (Microsoft 365, Google Workspace, Amazon SES, SendGrid...). Ưu tiên tài khoản/khóa chỉ để
   gửi, không dùng hộp thư cá nhân.
2. Tên miền trong `MAIL_FROM` phải có SPF và DKIM hợp lệ cho nhà cung cấp đó (thiếu thì thư vào spam hoặc bị từ chối).
3. Đặt `SMTP_URL` (ví dụ `smtps://user:mat-khau@smtp.nha-cung-cap.vn:465`, ký tự đặc biệt trong mật khẩu phải mã hóa URL)
   và `MAIL_FROM`, rồi `bash infra/dc.sh up -d api worker`.
4. Kiểm: log worker có `"channels":["email"]` ở dòng "Worker đã sẵn sàng"; tạo một phiếu thử và gửi duyệt, trưởng phòng
   nhận được email.

## Bật Zalo ZNS

Điều kiện: khách có Zalo Official Account doanh nghiệp đã xác thực, ứng dụng trên Zalo for Developers liên kết OA, các mẫu
ZNS đã được Zalo duyệt, tài khoản ZNS có số dư.

1. Đối chiếu tài liệu Zalo hiện hành với `apps/worker/src/notifications/zalo.ts`: URL gửi ZNS, URL làm mới token, tên
   trường, mã lỗi. Sửa nếu Zalo đã đổi (code chỉ được kiểm bằng máy chủ giả).
2. Đối chiếu tên tham số trong mẫu đã duyệt với `ZALO_PARAMS` (ví dụ `nguoi_dat_lai` của `account.password_reset`); sửa cho khớp.
3. Sinh khóa mã hóa: `openssl rand -base64 32`, đặt `APP_ENCRYPTION_KEY`. Lưu một bản ngoài máy chủ (trình quản lý mật
   khẩu của khách): mất khóa phải nạp lại token.
4. Đặt `ZALO_APP_ID`, `ZALO_SECRET_KEY`, `ZALO_TEMPLATES` (JSON một dòng, ví dụ
   `{"account.password_reset":"312345","import.finished":"312346"}`), `ZALO_ENABLED=true`.
5. Nạp refresh token (lấy trên trang quản lý ứng dụng), đọc từ tệp để không lọt lịch sử shell, xóa tệp ngay sau đó:
   `bash infra/dc.sh run --rm -T worker node dist/cli/zalo-token.js < token.txt && shred -u token.txt`
6. `bash infra/dc.sh up -d api worker`; đặt lại mật khẩu (quản trị) cho tài khoản có số điện thoại của người trong đội.

## Token Zalo hết hạn hoặc bị thu hồi

Dấu hiệu: cảnh báo "Token Zalo chưa làm mới được", lần giao Zalo FAILED với lỗi "Làm mới token Zalo bị từ chối". Làm lại
bước 5 phần trên. Các thông báo đã FAILED không tự gửi lại (thông báo trong app và email vẫn có).

## Nhiều thông báo gửi lỗi

```sql
-- bash infra/dc.sh exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
select channel, status, left(error, 80) as error, count(*)
from notification_deliveries where updated_at > now() - interval '24 hours'
group by 1, 2, 3 order by 4 desc;
```

- Email `535`/`authentication`: sai `SMTP_URL`. `550`: địa chỉ người nhận sai (sửa email người dùng).
- Zalo `-108`/số không hợp lệ: sửa số điện thoại người dùng. Lỗi mẫu: kiểm `ZALO_TEMPLATES` và `ZALO_PARAMS`.
- Gửi lại thủ công sau khi sửa cấu hình (chỉ các lần giao lỗi trong ngày, kênh đã sửa):
  `update notification_deliveries set status = 'PENDING', attempts = 0 where status = 'FAILED' and channel = 'email' and updated_at > now() - interval '1 day';`
  Lượt quét 10 phút sẽ gửi lại.

## Đổi APP_ENCRYPTION_KEY

Token cũ không giải mã được bằng khóa mới: đặt khóa mới, xóa token cũ
(`delete from integration_tokens where provider = 'zalo_oa';`), khởi động lại worker, nạp lại token (bước 5).
