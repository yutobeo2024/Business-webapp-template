# ADR-0004: Phân quyền động (quyền trong mã, vai trò trong DB)

- Ngày: 2026-10-03
- Trạng thái: Chấp nhận (thay phần vai trò cố định của bản 1.0)

## Bối cảnh

Mỗi doanh nghiệp có cơ cấu và tên gọi vai trò khác nhau, và thay đổi theo thời gian (thêm "Phó phòng", tách "Kế toán
thanh toán"). Vai trò cố định trong mã (enum) buộc phải sửa mã và phát hành mỗi lần khách đổi cơ cấu.

## Quyết định

- **Quyền (permission) khai báo trong mã** (`packages/shared/src/permissions.ts`), mỗi module tự khai báo quyền của mình
  kèm nhãn tiếng Việt. Quyền chỉ có nghĩa khi có mã thực thi nó, nên quản trị viên không tạo được quyền mới.
- **Vai trò là tập quyền lưu trong DB** (`roles`, `role_permissions`, `user_roles`), quản trị viên tạo và sửa trên giao diện.
  Một người có nhiều vai trò; quyền là hợp các vai trò.
- **Mã chỉ kiểm quyền** (`can()`, `@RequirePermission`), không bao giờ kiểm tên vai trò. Phạm vi dữ liệu là quyền có cấp
  (`x.view.all` > `x.view.department` > của mình).
- Quyền nạp mỗi request: đổi vai trò có hiệu lực ngay, không cần đăng nhập lại. Quyền trong DB không còn trong danh mục
  (module đã gỡ) bị bỏ qua.
- Chốt chặn (`apps/api/src/modules/admin/safeguards.ts`):
  - Quyền quản trị (`holderOnly`) chỉ người đang có mới cấp được; người không có không thao tác được trên tài khoản hay vai
    trò đang có nó (không chiếm tài khoản mạnh hơn mình qua đặt lại mật khẩu).
  - Vai trò hệ thống "Quản trị hệ thống" không xóa, không đổi tên, luôn giữ `users.manage`, `roles.manage`.
  - Không tự khóa, tự đổi vai trò, tự đổi phòng ban, tự đặt lại mật khẩu của mình; không sửa quyền của vai trò mình đang
    giữ (sửa vai trò của mình là cách tự cấp quyền). Vai trò hệ thống chỉ chứa quyền quản trị.
  - Luôn còn người đang hoạt động có CẢ `users.manage` và `roles.manage`; các thao tác có thể vi phạm xếp hàng bằng khóa
    dòng. Mất hết thì khôi phục từ máy chủ bằng `grant-admin`.

## Đánh đổi

- Cấu hình sai là có thể: quản trị viên gom nhầm quyền vào vai trò. Giảm thiểu bằng nhãn quyền nói rõ cho phép gì, audit
  mọi thay đổi vai trò, và spec mỗi module ghi vai trò mặc định đề xuất.
- Quyền nghiệp vụ không bị chặn leo thang: người có `users.manage` gán được vai trò nghiệp vụ dù bản thân không có (cần cho
  quản trị viên hệ thống không tham gia nghiệp vụ). Hệ quả: họ có thể tạo một tài khoản khác cho chính mình với quyền duyệt.
  Tương tự, họ đặt lại được mật khẩu của tài khoản nghiệp vụ (ví dụ giám đốc) rồi đăng nhập thay. Đây là rủi ro tách biệt
  nhiệm vụ, kiểm soát bằng audit (`user.create`, `user.update` ghi ai gán vai trò gì) và quy trình
  của khách; nếu khách cần chặt hơn, thêm duyệt hai người cho việc gán vai trò.
- Thêm một truy vấn mỗi request để nạp quyền. Chấp nhận được với quy mô mục tiêu (dưới vài nghìn người dùng); khi cần,
  cache theo phiên kèm phiên bản vai trò.

## Mở rộng

SSO/AD (ADR-0002, mục Mở rộng): ánh xạ nhóm của AD sang vai trò, quyền vẫn kiểm như trên.
