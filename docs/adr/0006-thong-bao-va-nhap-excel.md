# ADR-0006: Thông báo qua bảng giao nhận, token mã hóa, nhập Excel hai bước

- Ngày: 2026-10-03
- Trạng thái: Chấp nhận

## Bối cảnh

Thông báo chạy trong worker và có thể chạy lại (retry, worker khởi động lại); gửi ra dịch vụ ngoài (SMTP, Zalo) có thể
lỗi tạm thời hoặc vĩnh viễn. Nhập Excel dữ liệu thật của khách: nhập nửa chừng rồi lỗi thì rất khó dọn.

## Quyết định

- **Ba lớp cho thông báo**: `notifications` (trong app, duy nhất theo người nhận + dedupe_key) -> `notification_deliveries`
  (một hàng mỗi kênh) -> job `notification.deliver` theo id lần giao. Kênh không tự thử lại; job "giành" hàng
  PENDING -> SENDING nên không gửi song song hai lần; lượt quét 10 phút đẩy lại hàng kẹt. Bảo đảm ít nhất một lần: worker
  chết đúng lúc đang gửi thì có thể gửi lại một lần (chấp nhận, hiếm và vô hại hơn mất thông báo).
- **Email qua SMTP chung** (nodemailer): khách đổi nhà cung cấp chỉ đổi `SMTP_URL`. Dev và CI dùng Mailpit.
- **Zalo ZNS gọi API trực tiếp** bằng `fetch`, tắt mặc định. Token lưu **mã hóa AES-256-GCM** bằng `APP_ENCRYPTION_KEY`
  (ngoài DB, lộ bản sao lưu DB không lộ token). Refresh token Zalo dùng một lần, nên làm mới trong transaction khóa dòng và
  làm mới hằng ngày để không hết hạn khi lâu không gửi.
- **Nhập Excel hai bước, tất cả hoặc không**: worker kiểm và lưu lỗi/xem trước; người dùng xác nhận; worker kiểm lại và ghi
  trong MỘT transaction. Schema dòng dùng lại schema form nhập tay. Chặn zip bomb trước khi
  mở bằng giải nén THẬT từng mục có trần byte (không tin kích thước khai báo trong tệp); đọc cả tệp bằng `exceljs` (bộ đọc stream lỗi với một số thứ tự mục trong zip).

## Đánh đổi

- Endpoint, tham số, mã lỗi Zalo viết theo tài liệu tại thời điểm viết và chỉ được kiểm bằng máy chủ giả. Bật cho khách
  phải đối chiếu tài liệu Zalo hiện hành và gửi thử với OA thật (runbook notifications). Tên tham số mẫu (`ZALO_PARAMS`)
  phải khớp mẫu khách đăng ký.
- Chuông thông báo tải lại mỗi 60 giây, không thời gian thực (không thêm WebSocket/SSE cho một VPS).
- Nhập chỉ thêm mới; cập nhật hàng loạt bản ghi đã có cần thiết kế riêng (khóa, phiên bản, audit trước/sau).
- Mất `APP_ENCRYPTION_KEY` thì không giải mã được token: nạp lại token Zalo (không mất dữ liệu nghiệp vụ).

## Hệ quả

- Module mới cần báo tin: thêm loại vào `NOTIFICATION_TYPES` + mẫu nội dung, tính người nhận theo quyền trong
  `packages/server`, gọi `notify` từ worker và đẩy job giao sau commit.
- Module mới cần nhập Excel: thêm loại vào `IMPORT_TYPES` + schema dòng + định nghĩa kiểm/ghi, gắn `ImportButton`.
