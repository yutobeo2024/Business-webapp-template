# SPEC-003: Thông báo (trong app, email, Zalo) và nhập Excel (lõi của kit)

| Trường          | Giá trị                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trạng thái spec | Đã duyệt                                                                                                                                                                               |
| Module          | `packages/server/src/notifications`, `packages/server/src/imports`, `apps/worker/src/notifications`, `apps/worker/src/imports`, `apps/api/src/modules/{notifications,account,imports}` |
| Loại            | Lõi: giữ trong mọi dự án. Đổi hành vi phải sửa spec này trước. Kiến trúc: ADR-0006.                                                                                                    |

## 1. Mục tiêu và phạm vi

Báo cho đúng người khi có việc cần làm hoặc kết quả họ chờ (phiếu chờ duyệt, bị từ chối), qua thông báo trong app và
kênh ngoài (email, Zalo ZNS) mà mỗi người tự chọn. Nạp dữ liệu có sẵn của khách từ Excel lúc go-live mà không nhập nửa
chừng. Module nghiệp vụ chỉ khai báo loại thông báo + người nhận, loại nhập + cách kiểm và ghi.

Ngoài phạm vi: SMS, thông báo đẩy trên điện thoại, gửi hàng loạt cho khách hàng bên ngoài (marketing), thời gian thực
(chuông tải lại mỗi 60 giây), nhập cập nhật bản ghi đã có (chỉ thêm mới).

## 2. Quyền

Thông báo: mỗi người chỉ thấy và đánh dấu thông báo của mình; ai được báo do module tính theo quyền. Nhập: mỗi loại khai
báo quyền cần có (`IMPORT_TYPES[type].permission`); mẫu nhập phòng ban cần `departments.manage`.

## 3. Thực thể dữ liệu

| Thực thể                   | Trường chính                                                           | Dữ liệu cá nhân?                                                          |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| notifications              | user_id, type, title, body, link, data, dedupe_key, read_at            | Có (nội dung nghiệp vụ gửi cho một người)                                 |
| notification_deliveries    | notification_id, channel, status, attempts, error, provider_message_id | Không                                                                     |
| user_notification_settings | user_id, channel, enabled                                              | Không                                                                     |
| users.phone                | số di động 84xxxxxxxxx                                                 | Có: chỉ để gửi Zalo, xóa khi tài khoản ngừng dùng theo quy định của khách |
| integration_tokens         | provider, token mã hóa                                                 | Không (bí mật hệ thống, mã hóa)                                           |
| import_jobs                | type, file_id, status, errors, preview, requested_by                   | Có thể (dữ liệu trong tệp)                                                |

Thời gian lưu: thông báo đã đọc xóa sau 90 ngày; tệp nhập xóa sau 7 ngày kể từ khi lần nhập kết thúc (audit giữ sha256).

## 5. Quy tắc

Thông báo

- **BR-N1**: Người nhận tính lúc worker chạy theo quyền HIỆN TẠI và phải xem được bản ghi; tài khoản khóa không nhận.
  Nội dung chỉ chứa thứ người nhận được xem.
- **BR-N2**: Một sự kiện báo mỗi người đúng một lần: (người nhận, dedupe_key) duy nhất; job chạy lại không tạo thêm.
- **BR-N3**: Thông báo trong app luôn có. Email, Zalo: mỗi người tự tắt/bật; kênh hệ thống chưa cấu hình, người đã tắt,
  thiếu số điện thoại (Zalo) thì ghi SKIPPED kèm lý do.
- **BR-N4**: Mỗi kênh mỗi thông báo gửi tối đa một lần cùng lúc (giành PENDING -> SENDING); lỗi tạm thời thử lại tối đa 5
  lần, lỗi vĩnh viễn (địa chỉ sai, số không dùng Zalo, mẫu sai) FAILED ngay. Worker chết đúng lúc gửi có thể gửi lại một
  lần (ít nhất một lần).
- **BR-N5**: Email có bản HTML (mọi giá trị escape) và bản text; liên kết chỉ trỏ vào chính app (`APP_ORIGIN`).
- **BR-N6**: Token Zalo lưu mã hóa (`APP_ENCRYPTION_KEY`); làm mới trong transaction khóa dòng (một lần cho mọi job song
  song); làm mới hằng ngày để không hết hạn; bị từ chối thì báo quản trị nạp lại (`zalo-token`).

Nhập Excel

- **BR-I1**: Chỉ nhận `.xlsx`, kiểm theo nội dung; chặn tệp nở quá lớn khi giải nén (zip bomb) trước khi mở; tối đa
  `IMPORT_MAX_ROWS` dòng; chỉ đọc sheet đầu; giá trị công thức lấy kết quả đã lưu, không chạy công thức.
- **BR-I2**: Dòng đầu là tiêu đề, khớp không phân biệt hoa thường và thứ tự; thiếu cột bắt buộc thì báo cả tệp.
- **BR-I3**: Mỗi dòng kiểm bằng CÙNG schema với form nhập tay, cộng trùng trong tệp và trùng với dữ liệu đã có; lỗi chỉ ra
  dòng và cột.
- **BR-I4**: Có bất kỳ lỗi nào thì không nhập dòng nào. Xác nhận thì kiểm LẠI rồi ghi tất cả trong một transaction; dữ liệu
  đổi giữa lúc xem trước và xác nhận thì không ghi, báo lỗi mới.
- **BR-I5**: Chỉ người tải lên xem, xác nhận, hủy (người khác 404); xác nhận hai lần chỉ nhận một. Quyền kiểm lại ở cả hai
  bước. Audit: tải lên, xác nhận, ghi (số dòng).
- **BR-I6**: Yêu cầu kẹt ở đang kiểm/đang nhập quá 30 phút thành Lỗi hệ thống; đã kiểm xong mà bỏ đó quá 7 ngày thì tự hủy
  (kiểm mỗi 15 phút), sau đó tệp được dọn.

## 6. Vận hành

Cấu hình kênh, bật Zalo, nạp và gia hạn token, xử lý thông báo gửi lỗi: `docs/runbooks/notifications.md`.
`alert-check.sh` cảnh báo khi nhiều thông báo gửi lỗi trong 24 giờ hoặc token Zalo quá 48 giờ chưa làm mới được.

## 10. Tiêu chí nghiệm thu

- **AC-N1**: Cho nhân viên gửi phiếu, Khi worker xử lý xong, Thì trưởng phòng cùng phòng ban thấy chuông có số, bấm thông
  báo mở đúng phiếu. (E2E)
- **AC-N2**: Cho trưởng phòng bật email, Khi phiếu chờ duyệt, Thì nhận một email đúng tiêu đề, kể cả khi job chạy lại.
- **AC-N3**: Cho người dùng tắt email, Khi có thông báo, Thì không có email, lần giao ghi SKIPPED.
- **AC-I1**: Cho quản trị tải tệp có một dòng sai mã, Thì thấy lỗi đúng dòng, nút xác nhận không hiện, không phòng ban nào
  được tạo. (E2E)
- **AC-I2**: Cho tệp đúng, Khi xác nhận, Thì mọi phòng ban được tạo và tìm thấy trong danh sách. (E2E)
