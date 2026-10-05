# ADR-0005: Lưu tệp trên đĩa máy chủ, xuất file chạy nền, PDF bằng Chromium

- Ngày: 2026-10-03
- Trạng thái: Chấp nhận

## Bối cảnh

App nghiệp vụ cần đính kèm chứng từ và xuất Excel/PDF. Triển khai mặc định là một VPS (ADR-0003). Xuất lớn trong request
HTTP làm treo API và hết thời gian ở proxy; dữ liệu xuất mà đi đường riêng thì dễ rộng hơn thứ người dùng được xem.

## Quyết định

- **Lưu tệp trên đĩa máy chủ** (thư mục host `FILES_DIR`, mount vào api và worker), mọi mã đi qua interface `FileStorage`
  (`packages/server/src/storage.ts`). Thêm S3/MinIO sau này: viết driver mới implement `FileStorage`, chọn trong
  `createStorage` theo `STORAGE_DRIVER`, không sửa module. Bind mount (không phải named volume) để sao lưu từng tệp bằng
  `rclone sync` và khôi phục trực tiếp.
- **Gói `packages/server`**: logic phía server dùng chung api và worker (truy vấn đọc, phạm vi xem, list-query, lưu tệp).
  Worker xuất dữ liệu bằng đúng hàm màn hình dùng, nên không thể xuất rộng hơn phạm vi xem.
- **Mọi lần xuất chạy nền** trong hàng đợi `exports` riêng (ít luồng), người dùng tải về khi xong. Đơn giản hơn hai đường
  (nhỏ thì trả ngay, lớn thì chạy nền) và không có ngưỡng nào để đoán sai.
- **PDF bằng HTML -> Chromium** (`playwright-core`, Chromium của Debian trong image worker, font Noto đủ dấu tiếng Việt).
  Mẫu in là HTML/CSS, agent và lập trình viên đều sửa được; thư viện vẽ PDF thủ công khó làm bảng và tiếng Việt.
- Excel bằng `exceljs` (WorkbookWriter): dữ liệu đọc theo trang 1.000 dòng, tệp kết quả gom trong RAM rồi mới lưu;
  với giới hạn mặc định 100.000 dòng vẫn vừa giới hạn RAM worker. Tăng `EXPORT_MAX_ROWS` nhiều thì chuyển sang ghi
  thẳng ra storage.

## Đánh đổi

- Image worker chuyển từ Alpine sang Debian slim và lớn hơn nhiều (Chromium cùng thư viện đồ họa, khoảng 750 MB trước nén).
  Chấp nhận: worker không cần khởi động nhanh, và một image duy nhất dễ vận hành hơn thêm dịch vụ in PDF riêng.
- Chromium trong container chạy không sandbox (không có user namespace). Bù bằng: HTML do mã sinh, escape mọi dữ liệu
  (`html`), tắt JavaScript, chặn mọi request mạng của trang, container chạy user `node`, giới hạn RAM.
- Đĩa máy chủ không mở rộng ngang được; nhiều máy chủ hoặc dữ liệu rất lớn thì chuyển sang driver S3.
- Tệp xuất giữ tạm `EXPORT_TTL_HOURS` rồi xóa: người dùng cần tệp lâu dài thì tải về lưu.

## Hệ quả

- Sao lưu có hai phần: DB (`backup-db.sh`) và tệp (`backup-files.sh`); khôi phục cần cả hai (runbook backup-restore).
- Caddy giới hạn body 11 MB; tăng `FILE_MAX_MB` thì tăng `max_size` trong `infra/Caddyfile`.
- Module mới cần đính kèm hoặc xuất file dùng lõi này (spec 002), không tự ghi đĩa hay tự sinh file trong request.
