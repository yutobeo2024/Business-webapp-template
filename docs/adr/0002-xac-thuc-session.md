# ADR-0002: Xác thực bằng session cookie

- Ngày: 2026-10-02
- Trạng thái: Chấp nhận

## Quyết định

Session lưu trong PostgreSQL (bảng `sessions`, chỉ lưu SHA-256 của token), cookie `sid` HttpOnly, Secure, SameSite=Lax.
Mật khẩu argon2id. Khóa tài khoản 15 phút sau 5 lần sai (đếm trong transaction có khóa dòng). Rate limit đăng nhập
10 lần/phút/IP. Mọi lần đăng nhập thất bại (sai email, sai mật khẩu, đang bị khóa) trả cùng một thông báo 401 để không
lộ email nào tồn tại. Chống CSRF bằng kiểm Origin cho mọi request ghi.
Phiên trượt: hết hạn sau `SESSION_TTL_HOURS` (12 giờ) không hoạt động, cookie được gia hạn cùng phiên; hạn tuyệt đối
`SESSION_MAX_DAYS` (7 ngày) kể từ lúc đăng nhập, để token bị đánh cắp không dùng được mãi.

Đánh đổi đã biết: khóa tài khoản cho phép người ngoài cố tình khóa tài khoản của người khác 15 phút (cần biết email).
Khi khách cần chặt hơn: thêm CAPTCHA sau vài lần sai, hoặc SSO/2FA (xem Mở rộng).

## Lý do

Thu hồi phiên tức thì (khóa nhân viên nghỉ việc), không có token dài hạn trong JavaScript, đơn giản để kiểm toán.
JWT không thu hồi được trước hạn nếu không thêm danh sách chặn, tức quay lại trạng thái có server.

## Mở rộng

Doanh nghiệp có AD/Microsoft 365/Google Workspace: thêm đăng nhập OIDC (hoặc Keycloak) trước lớp session hiện có; 2FA TOTP cho vai trò duyệt chi.
