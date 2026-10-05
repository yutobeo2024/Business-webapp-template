# SPEC-000: Quản trị người dùng, vai trò, phòng ban (lõi của kit)

| Trường          | Giá trị                                                        |
| --------------- | -------------------------------------------------------------- |
| Trạng thái spec | Đã duyệt                                                       |
| Module          | `apps/api/src/modules/admin`, `apps/web/src/features/admin`    |
| Loại            | Lõi: giữ trong mọi dự án. Đổi hành vi phải sửa spec này trước. |

## 1. Mục tiêu và phạm vi

Quản trị viên của khách tự quản lý tài khoản, vai trò và phòng ban, không cần đội phát triển. Phân quyền theo ADR-0004.
Ngoài phạm vi: SSO/AD, xác thực hai lớp, mời qua email (thêm khi khách yêu cầu).

## 2. Quyền

| Quyền                | Cho phép                                                              |
| -------------------- | --------------------------------------------------------------------- |
| `users.manage`       | Xem, tạo, sửa người dùng; khóa/mở khóa; đặt lại mật khẩu; gỡ tạm khóa |
| `roles.manage`       | Xem, tạo, sửa, xóa vai trò và quyền của vai trò                       |
| `departments.manage` | Xem, tạo, sửa, ngừng dùng phòng ban                                   |

Cả ba là quyền quản trị (`holderOnly`). Vai trò mặc định "Quản trị hệ thống" có cả ba, không có quyền nghiệp vụ.

## 3. Thực thể dữ liệu

| Thực thể         | Trường chính                                                                 | Dữ liệu cá nhân? |
| ---------------- | ---------------------------------------------------------------------------- | ---------------- |
| users            | email, full_name, department_id, is_active, must_change_password, version    | Có (tên, email)  |
| roles            | name (duy nhất, không phân biệt hoa thường), description, is_system, version | Không            |
| role_permissions | role_id, permission                                                          | Không            |
| user_roles       | user_id, role_id                                                             | Không            |
| departments      | code (duy nhất), name, is_active, version                                    | Không            |

## 5. Quy tắc

- **BR-A1**: Tài khoản mới có mật khẩu tạm do quản trị viên đặt; người dùng phải đổi trước khi làm bất cứ việc gì khác.
- **BR-A2**: Mật khẩu 10-128 ký tự, không chứa tên đăng nhập (phần trước @), khác mật khẩu hiện tại. Đổi mật khẩu thu hồi
  các phiên khác của người đó.
- **BR-A3**: Khóa tài khoản và đặt lại mật khẩu thu hồi mọi phiên của người đó ngay. Đặt lại mật khẩu gỡ luôn tạm khóa
  do đăng nhập sai.
- **BR-A4**: Quyền quản trị chỉ người đang có mới cấp được (qua vai trò); không thao tác được trên tài khoản hay vai trò mang
  quyền quản trị mình chưa có. Quyền nghiệp vụ người quản lý tài khoản gán được.
- **BR-A5**: Luôn còn ít nhất một người đang hoạt động có CẢ `users.manage` và `roles.manage` (chỉ còn một trong hai thì
  không ai cấp lại được quyền kia, hệ thống kẹt). Mất hết vẫn còn đường khôi phục từ máy chủ: `grant-admin` (runbook).
- **BR-A6**: Vai trò hệ thống không xóa, không đổi tên, luôn giữ `users.manage`, `roles.manage`, và chỉ chứa quyền quản
  trị (tách biệt nhiệm vụ: người quản trị cần quyền nghiệp vụ thì được quản trị viên KHÁC gán thêm vai trò nghiệp vụ).
- **BR-A7**: Không tự khóa, tự đổi vai trò, tự đổi phòng ban, tự đặt lại mật khẩu của mình, và không sửa quyền của vai trò
  mình đang giữ (nếu không, sửa vai trò của mình là cách tự cấp quyền).
- **BR-A8**: Không xóa vai trò còn người dùng. Không xóa phòng ban, chỉ ngừng dùng; phòng ban ngừng dùng không nhận người mới
  (người cũ giữ nguyên).
- **BR-A9**: Sửa người dùng, vai trò, phòng ban có kiểm phiên bản; sửa đè thay đổi của người khác trả 409.
- **BR-A10**: Mọi thao tác quản trị ghi audit (ai, khi nào, IP, trước/sau), không bao giờ ghi mật khẩu hay mã băm.
- **BR-A11**: Số di động của người dùng (tùy chọn) chỉ để gửi thông báo Zalo (spec 003); lưu dạng chuẩn 84xxxxxxxxx, chỉ
  nhận đầu số di động Việt Nam. Sửa người dùng không gửi trường số thì giữ số cũ, gửi rỗng thì xóa.
- **BR-A12**: Nhập phòng ban từ Excel theo lõi nhập (spec 003): cùng quy tắc mã/tên với form, mã trùng trong tệp hoặc đã
  có thì báo lỗi, có lỗi thì không tạo phòng ban nào.

## 10. Tiêu chí nghiệm thu

- **AC-A1**: Quản trị viên tạo vai trò mới và người dùng với mật khẩu tạm; người đó đăng nhập, bị bắt đổi mật khẩu, sau đó
  làm được đúng việc vai trò cho phép. (E2E `e2e/admin.spec.ts`)
- **AC-A2**: Người chỉ có `users.manage` không gán được vai trò Quản trị hệ thống và không đặt lại được mật khẩu của quản trị
  viên. (tích hợp `test/admin.int.spec.ts`)
- **AC-A3**: Gỡ quyền khỏi vai trò có hiệu lực ngay ở request kế tiếp của người đang đăng nhập. (tích hợp)
- **AC-A4**: Không thao tác nào làm hệ thống mất người quản trị vai trò cuối cùng. (tích hợp)
