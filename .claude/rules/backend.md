---
paths:
  - "apps/api/**/*.ts"
  - "apps/worker/**/*.ts"
  - "packages/server/**/*.ts"
---

# Backend

- Import tương đối có đuôi `.js`. Inject token (`DB`, `ENV`, `NOTIFICATIONS_QUEUE`) bằng `@Inject(TOKEN)`.
- Controller mỏng: `@RequirePermission("module.action")` (ở class hoặc handler), `@Body(new ZodPipe(schema))`,
  `@Param("id", new ZodPipe(z.uuid()))`, gọi service, trả DTO.
- Quyền: kiểm bằng `can(actor, "...")` (state machine, policy, service). Cấm `actor.role`, cấm so tên vai trò. Quyền của
  module khai báo trong shared (`XXX_PERMISSIONS`, nhãn tiếng Việt nói rõ cho phép gì) và đăng ký vào `PERMISSIONS`.
  Phạm vi xem dữ liệu là quyền có cấp (`x.view.all` > `x.view.department` > của mình), lọc ở tầng query trong
  `packages/server/src/<module>/policy.ts`.

<!-- sample:begin -->

Mẫu: `packages/server/src/purchase-requests/policy.ts`.
<!-- sample:end -->

- Service: ghi nhiều bảng trong một `this.db.transaction(async (tx) => ...)`. Hàm phụ nhận `DbOrTx`.
- Cập nhật bản ghi có sửa đồng thời: `.for("update")` + điều kiện `version` + tăng `version`; lệch thì `Errors.versionConflict()`.
- Bộ đếm, tồn kho, số dư, hạn mức: KHÔNG đọc rồi ghi giá trị tuyệt đối (request song song ghi đè nhau). Đọc bằng
  `.for("update")` trong transaction rồi mới tính, hoặc cập nhật nguyên tử ``set({ n: sql`${t.n} + 1` })``.
  Mẫu: `AuthService.recordFailedLogin`.
- Tiền: trường nhập dùng `vndSchema`; số tiền tính ra (thành tiền, tổng) phải qua `isValidVnd` trong schema
  (từ `@app/shared`), nếu không tổng vượt 2^53 sẽ lưu sai hoặc lỗi 500.
- Gọi bên ngoài (email, Zalo, kế toán, xuất file nặng) đẩy sang worker; enqueue SAU commit, `jobId` theo phiên bản để không trùng.
- Processor trong worker phải idempotent (job có thể chạy lại khi retry).
- Danh sách: schema `listQuerySchema({ sortable, defaultSort })` + `.extend` bộ lọc; service dùng `searchCondition`,
  `orderBy(sort, order, SORTABLE, bảng.id)`, `paginated` (`@app/server`). Cột sắp xếp tra trong bảng `SORTABLE`
  (`satisfies Record<Query["sort"], unknown>`), không bao giờ ghép tên cột từ input. Mẫu: `listUsers`
  (`packages/server/src/users/queries.ts`).
- Truy vấn đọc mà worker cũng cần (xuất file, báo cáo, thông báo) đặt trong `packages/server` và dùng ở cả hai nơi.
  Không chép truy vấn hay điều kiện phạm vi xem sang worker.
- Tệp: chỉ qua `storeFile` (trong `withStoredFile`, cùng transaction với audit) với danh sách loại cho phép của module;
  tải về chỉ qua `sendFile` sau khi kiểm quyền xem bản ghi chứa tệp. Không ghi đĩa trực tiếp, không dùng tên tệp người
  dùng làm đường dẫn.

<!-- sample:begin -->

Mẫu: `PurchaseRequestAttachmentsService`.
<!-- sample:end -->

- Xuất file: không bao giờ sinh file trong request HTTP. Thêm loại vào danh mục xuất + runner trong worker (spec 002);
  runner lấy dữ liệu bằng hàm trong `packages/server` với `ctx.actor` (quyền hiện tại của người yêu cầu).
- Thông báo: chỉ qua `notify` + job giao (spec 003). Người nhận tính lúc worker chạy theo quyền hiện tại, phải xem được
  bản ghi; `dedupeKey` theo sự kiện (ví dụ `pr-<id>-v<version>`) để job chạy lại không báo hai lần. Nội dung không chứa
  thứ người nhận không được xem.
- Nhập Excel: chỉ qua lõi nhập (spec 003). Schema dòng dùng lại schema form; `checkAgainstDb` kiểm trùng; `commit` ghi tất
  cả trong transaction của nơi gọi, không tự commit từng dòng, không nuốt lỗi.
- Bí mật của dịch vụ ngoài lưu trong DB (token OAuth...) phải mã hóa bằng `encryptSecret` (`APP_ENCRYPTION_KEY`); token
  dùng một lần thì làm mới trong transaction khóa dòng (mẫu: `ZaloZnsSender.accessToken`).
- Mỗi quy tắc BR-xx có test: unit test cho `decide()`/policy, test tích hợp cho luồng ghi DB.
