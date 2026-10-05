# Bảo mật (luôn áp dụng)

- Mọi endpoint mặc định yêu cầu đăng nhập (SessionGuard toàn cục). Chỉ `@Public()` khi spec ghi rõ.
- Kiểm quyền theo cả hành động (state machine) VÀ phạm vi dữ liệu (policy, lọc ở query). Chống IDOR: không có quyền xem thì trả 404.
- Phân quyền theo quyền (ADR-0004), không theo tên vai trò. Quyền quản trị đánh dấu `holderOnly`: chỉ người đang có mới cấp
  được, người không có không thao tác được trên tài khoản đang có nó. Chốt chặn quản trị nằm ở
  `modules/admin/safeguards.ts` (luôn còn người quản trị, không tự khóa mình, khóa/đặt lại mật khẩu thu hồi phiên).
- Audit không bao giờ chứa mật khẩu hay mã băm: ghi các trường chọn lọc (xem `auditView` trong `users.service.ts`).
- Request ghi dữ liệu đi qua OriginGuard (chống CSRF). Không thêm ngoại lệ.
- Không trả stack trace, SQL, đường dẫn nội bộ trong response. HttpExceptionFilter đã chuẩn hóa, không bypass.
- Không log mật khẩu, token, cookie, số CCCD, số tài khoản, dữ liệu sức khỏe. Pino đã redact cookie/authorization.
- SQL thô chỉ qua template `sql\`...\`` của Drizzle (tham số hóa). Cấm nối chuỗi vào câu SQL.
- Upload/tải tệp chỉ qua lõi tệp (spec 002): loại kiểm theo NỘI DUNG (`storeFile` + danh sách cho phép của module),
  giới hạn `FILE_MAX_MB`, khóa lưu do hệ thống sinh; tải về qua `sendFile` (luôn attachment, nosniff, CSP sandbox) sau khi
  kiểm quyền xem bản ghi chứa tệp. Không bao giờ phục vụ tệp người dùng tải lên dạng inline.
- Xuất dữ liệu (spec 002): cùng truy vấn và phạm vi xem với màn hình, quyền kiểm cả lúc yêu cầu lẫn lúc worker chạy, chỉ
  người yêu cầu tải được, audit yêu cầu và tải về. Mẫu PDF chỉ dựng bằng `html` (escape), không ghép chuỗi HTML.
- Thông báo (spec 003): người nhận theo quyền hiện tại và phải xem được bản ghi; email escape bằng `html`, liên kết chỉ trỏ
  vào APP_ORIGIN; số điện thoại là dữ liệu cá nhân, chỉ dùng cho Zalo. Token dịch vụ ngoài lưu mã hóa, không log.
- Nhập Excel (spec 003): chỉ .xlsx kiểm theo nội dung, chặn zip bomb trước khi mở (`checkZip`), giới hạn dòng, không chạy
  công thức, kiểm lại quyền và dữ liệu lúc xác nhận, tất cả hoặc không.
- Thao tác nhạy cảm (duyệt, xóa, đổi quyền, xuất hàng loạt, nhập dữ liệu) phải `writeAudit` trong cùng transaction.
- Dữ liệu cá nhân: chỉ thu thập trường cần cho nghiệp vụ, ghi mục đích và thời gian lưu trong spec.
