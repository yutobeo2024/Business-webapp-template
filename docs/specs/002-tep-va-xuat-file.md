# SPEC-002: Tệp đính kèm và xuất file (lõi của kit)

| Trường          | Giá trị                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Trạng thái spec | Đã duyệt                                                                                                                            |
| Module          | `packages/server`, `apps/api/src/files`, `apps/api/src/modules/exports`, `apps/worker/src/exports`, `apps/web/src/features/exports` |
| Loại            | Lõi: giữ trong mọi dự án. Đổi hành vi phải sửa spec này trước. Kiến trúc: ADR-0005.                                                 |

## 1. Mục tiêu và phạm vi

Mọi app nghiệp vụ cần đính kèm chứng từ (báo giá, hóa đơn, ảnh) và lấy dữ liệu ra ngoài (Excel để tính toán, PDF để in
ký). Lõi này cho một cách làm duy nhất, an toàn sẵn ở những chỗ hay sai: kiểm loại tệp, đường dẫn lưu, tải tệp của người
khác, xuất vượt phạm vi xem, treo API khi xuất lớn. Module nghiệp vụ chỉ khai báo loại tệp cho phép, loại xuất và runner.

Ngoài phạm vi: lưu S3 (có sẵn interface, chưa có driver), quét virus, xem trước tệp trong trình duyệt, xuất theo lịch,
nhập Excel (bước 2c).

## 2. Quyền

Lõi không có quyền riêng. Quyền xem/tải tệp đính kèm = quyền xem bản ghi chứa tệp; quyền thêm/xóa do module quyết định.
Mỗi loại xuất khai báo quyền cần có (`EXPORT_TYPES[type].permission`) hoặc `null` (chỉ cần xem được dữ liệu). Lõi:
`users.manage` cho Excel danh sách người dùng (`admin.users.xlsx`); loại in một bản ghi thường để `null`.

## 3. Thực thể dữ liệu

| Thực thể    | Trường chính                                                                                   | Dữ liệu cá nhân?           |
| ----------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| files       | storage_key, original_name, mime_type, size_bytes, sha256, entity_type, entity_id, uploaded_by | Có thể (nội dung chứng từ) |
| export_jobs | type, params, status, row_count, error, file_id, requested_by, expires_at                      | Không (tham số lọc)        |

Thời gian lưu: tệp đính kèm theo bản ghi chứa nó; xóa là xóa mềm, sau 7 ngày tệp vật lý và hàng `files` bị xóa hẳn
(audit xóa giữ `storageKey` để lấy lại từ bản sao lưu). Tệp xuất tải được trong
`EXPORT_TTL_HOURS` (mặc định 24 giờ) rồi bị xóa; hàng `export_jobs` giữ lại làm lịch sử.

## 5. Quy tắc

- **BR-F1**: Loại tệp xác định theo NỘI DUNG (magic bytes), không theo đuôi tên hay Content-Type trình duyệt gửi. Chỉ nhận
  loại trong danh sách cho phép của module; sai loại: 415, quá `FILE_MAX_MB`: 413, rỗng hoặc thiếu tệp: 400.
- **BR-F2**: Khóa lưu do hệ thống sinh (`yyyy/mm/<uuid>`), không bao giờ chứa tên gốc; tên gốc chỉ để hiển thị, đã làm
  sạch, đuôi theo loại thật.
- **BR-F3**: Tải tệp luôn là `attachment` (không hiển thị trong trình duyệt), có `nosniff` và CSP `sandbox`, sau khi đã kiểm
  quyền xem bản ghi chứa tệp. Ngoài phạm vi xem: 404.
- **BR-F4**: Lưu tệp và ghi hàng `files` + audit trong cùng transaction; transaction lỗi thì tệp vật lý bị xóa.
- **BR-E1**: Mọi lần xuất chạy nền trong worker; API chỉ kiểm quyền, ghi yêu cầu + audit `export.request`, đẩy job sau commit.
- **BR-E2**: Dữ liệu xuất lấy bằng CÙNG truy vấn và phạm vi xem với màn hình gốc (`packages/server`), với quyền HIỆN TẠI
  của người yêu cầu lúc worker chạy: bị khóa hoặc mất quyền giữa chừng thì yêu cầu FAILED, không có tệp.
- **BR-E3**: Chỉ người yêu cầu thấy và tải được kết quả (người khác: 404, kể cả người xem được mọi dữ liệu). Tải về ghi
  audit `export.download`. Hết hạn: 410; chưa xong: 409.
- **BR-E4**: Mỗi người tối đa 3 lần xuất chưa xong; lần thứ 4: 429.
- **BR-E5**: Excel giới hạn `EXPORT_MAX_ROWS` dòng (mặc định 100.000); vượt thì FAILED với hướng dẫn lọc bớt, không cắt
  ngầm. Ngày giờ theo giờ Việt Nam, tiền là số (cộng được trong Excel).
- **BR-E6**: Mẫu PDF chỉ dựng bằng tagged template `html` (escape mọi giá trị). Chromium tắt JavaScript, chặn mọi request
  mạng của trang.
- **BR-E7**: Chạy lại một yêu cầu đã DONE/FAILED không làm gì (job retry an toàn). Yêu cầu chờ/chạy quá 1 giờ bị đánh dấu
  FAILED (kiểm mỗi 15 phút) để người dùng xuất lại.

## 6. Vận hành

Thư mục tệp trên host `FILES_DIR` (mặc định `/opt/app-data/files`) mount vào api và worker; sao lưu bằng
`infra/backup-files.sh` (cron 02:30), cảnh báo khi quá 26 giờ chưa sao lưu được. Dọn dẹp lúc 04:00 trong worker.

## 10. Tiêu chí nghiệm thu

- **AC-F1**: Cho nhân viên với phiếu Nháp, Khi đính kèm một PDF rồi bấm vào tên tệp, Thì tải về đúng tệp, đúng tên tiếng
  Việt. (E2E)
- **AC-F2**: Cho tệp chạy được đổi đuôi `.pdf`, Khi tải lên, Thì bị từ chối với thông báo loại tệp không được phép. (E2E)
- **AC-E1**: Cho trưởng phòng KD, Khi xuất Excel danh sách phiếu, Thì tệp chỉ chứa phiếu phòng KD và phiếu của chính mình.
- **AC-E2**: Cho người dùng bấm "Xuất Excel", Khi worker tạo xong, Thì trang "Tệp đã xuất" tự chuyển sang "Xong" và tải
  được tệp. (E2E)
- **AC-E3**: Cho người yêu cầu bị thu quyền của loại xuất sau khi bấm xuất, Khi worker chạy, Thì yêu cầu "Lỗi", không có tệp.
