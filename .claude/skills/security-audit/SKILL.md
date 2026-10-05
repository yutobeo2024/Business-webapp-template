---
name: security-audit
description: Rà soát bảo mật một khoảng thay đổi (mặc định nhánh hiện tại so với main) theo OWASP và đặc thù app nghiệp vụ (phân quyền, IDOR, CSRF, audit, dữ liệu cá nhân). Dùng trước release hoặc khi đụng xác thực, phân quyền, upload, thanh toán, xuất dữ liệu.
argument-hint: "[khoảng git, ví dụ v1.4.0..HEAD; để trống = main...HEAD]"
context: fork
agent: code-reviewer
background: false
---

# Rà soát bảo mật

Khoảng thay đổi cần rà: `$ARGUMENTS` (để trống thì dùng `main...HEAD`).

0. Chạy `git diff <khoảng> --stat`. **Diff rỗng thì DỪNG** và báo "không có thay đổi để rà trong khoảng này",
   không kết luận ĐƯỢC RELEASE trên một diff rỗng (ví dụ đang đứng trên `main` mà dùng `main...HEAD`:
   khi đó cần khoảng `<tag gần nhất>..HEAD`).
1. Đọc `git diff <khoảng>` và `.claude/rules/security.md`. Với từng mục ghi Đạt / Không đạt / Không áp dụng kèm `file:dòng`:

   1. Xác thực: endpoint mới có `@Public()` ngoài ý muốn? Phiên có hạn, đăng xuất xóa phiên?
   2. Phân quyền: kiểm cả hành động (state machine) và phạm vi dữ liệu (policy ở query). Đổi id trên URL xem được dữ liệu người khác không?
   3. CSRF: request ghi đi qua OriginGuard; không có endpoint ghi dùng GET.
   4. Validate input ở mọi biên, kể cả webhook và payload job.
   5. Injection: `sql` nối chuỗi, lệnh shell ghép từ input, HTML không escape (`dangerouslySetInnerHTML`).
   6. Upload/tải file: loại kiểm theo nội dung (`storeFile`), dung lượng, khóa lưu do hệ thống sinh, tải về qua `sendFile`
      sau khi kiểm quyền xem bản ghi chứa tệp. Xuất dữ liệu: cùng phạm vi xem với màn hình, quyền kiểm lại lúc worker chạy,
      chỉ người yêu cầu tải được, mẫu PDF escape bằng `html`. Thông báo: đúng người nhận theo quyền hiện tại, không lộ
      nội dung, không gửi trùng, token mã hóa. Nhập Excel: zip bomb, giới hạn dòng, tất cả hoặc không, kiểm lại lúc xác nhận.
   7. Lộ thông tin: response lỗi, log chứa dữ liệu nhạy cảm, secret trong mã hoặc lịch sử git; thông báo lỗi
      khác nhau làm lộ dữ liệu tồn tại hay không (email, mã phiếu).
   8. Audit: thao tác nhạy cảm có ghi đủ ai, khi nào, IP, trước, sau, trong cùng transaction.
   9. Rate limit cho đăng nhập, OTP, xuất dữ liệu, endpoint tốn tài nguyên.
   10. Đồng thời: bộ đếm, hạn mức, số dư đọc rồi ghi không khóa dòng (request song song ghi đè nhau).
   11. Dependency mới: còn bảo trì, `pnpm audit --prod` sạch mức high.
   12. Dữ liệu cá nhân: tối thiểu, có mục đích, có thời gian lưu.

Kết luận một dòng: ĐƯỢC RELEASE hoặc CHƯA ĐƯỢC RELEASE, kèm danh sách việc bắt buộc sửa.
