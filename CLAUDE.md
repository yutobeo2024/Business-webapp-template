# CLAUDE.md

## Dự án

<TÊN DỰ ÁN>: web app quản lý quy trình nghiệp vụ cho <KHÁCH HÀNG>. Sản phẩm PRODUCTION chạy trên dữ liệu thật
của doanh nghiệp: ưu tiên đúng và an toàn hơn nhanh.
Spec nghiệp vụ: `docs/specs/`. Quyết định kiến trúc: `docs/adr/`. Vận hành: `docs/runbooks/`.

## Stack

Monorepo pnpm + Turborepo, TypeScript strict, ESM, Node 24 LTS.

- `apps/api`: NestJS 12, xác thực session cookie, guard mặc định bắt đăng nhập.
- `apps/worker`: BullMQ (thông báo trong app/email/Zalo, xuất Excel/PDF, nhập Excel, job định kỳ). `apps/web`: React 19 + Vite, TanStack Router/Query, Tailwind, React Hook Form.
- `packages/db`: Drizzle ORM + PostgreSQL 17 (schema, migration). `packages/shared`: Zod schema + type dùng chung FE/BE.
- `packages/server`: logic phía server dùng chung api và worker (truy vấn đọc, phạm vi xem, list-query, lưu tệp).
  Thứ gì worker cũng cần thì đặt ở đây, không chép sang worker.

## Lệnh

- `pnpm dev:services` (Postgres + Redis bằng Docker), `pnpm dev`, `pnpm build`
- `pnpm verify:quick` = lint + typecheck + unit test. PHẢI xanh trước khi báo xong (hook Stop tự chạy).
- `pnpm test:integration` (DB/Redis test của dự án lấy từ `TEST_DATABASE_URL`, `TEST_REDIS_URL` trong `.env`)
- DB: sửa `packages/db/src/schema.ts` rồi `pnpm db:generate --name <ten_thay_doi>`; áp dụng: `pnpm db:migrate`.
  DB cục bộ bẩn hoặc lệch migration chưa commit: `pnpm db:reset-local` (test) / `pnpm db:reset-local dev`.
- `pnpm test:e2e` (cần `pnpm build`, DB đã migrate + `pnpm db:seed -- --demo`).

<!-- sample:begin -->

- `pnpm sample:remove`: gỡ module mẫu, chạy TRƯỚC khi viết module thật đầu tiên (commit riêng).

<!-- sample:end -->

## Lõi có sẵn: dùng lại, không viết lại

- Phân quyền (ADR-0004): QUYỀN khai báo trong mã (`packages/shared/src/permissions.ts`), VAI TRÒ là tập quyền do quản trị
  viên cấu hình trên giao diện. Mã chỉ kiểm quyền bằng `can(user, "...")` / `@RequirePermission(...)`, KHÔNG BAO GIỜ kiểm
  tên vai trò. Module mới khai báo quyền của mình (dạng như `CORE_PERMISSIONS`) rồi đăng ký vào `PERMISSIONS`.
- Quản trị người dùng, vai trò, phòng ban, đổi mật khẩu: `apps/api/src/modules/admin/`, `apps/web/src/features/admin/`
  (spec 000). Không sửa chốt chặn trong `safeguards.ts` khi chưa có spec duyệt.
- Danh sách: `listQuerySchema` (shared) + `searchCondition`/`orderBy`/`paginated` (`@app/server`) +
  `DataTable`/`SortTh`/`Pagination`/`SearchInput` và bộ lọc trên URL (`searchValidator`, `nextSearch`) ở web.
- Tệp đính kèm (spec 002, ADR-0005): lưu bằng `storeFile` trong `withStoredFile` + transaction có audit (kiểm loại theo
  nội dung, giới hạn dung lượng), tải về chỉ qua `sendFile` sau khi kiểm quyền xem bản ghi chứa tệp.
  Chính sách giữ tệp sau xóa mềm theo loại: `FILE_RETENTION` (`packages/server/src/files.ts`; chứng từ kế toán khai báo `"forever"`).

<!-- sample:begin -->

Mẫu: `modules/purchase-requests/attachments.service.ts`, web `attachments-dialog.tsx`.
<!-- sample:end -->

- Xuất Excel/PDF (spec 002): luôn chạy nền. Loại xuất mới = một mục trong `createExportSchema` + `EXPORT_TYPES`
  (`packages/shared/src/exports.ts`), nhánh kiểm trước trong `ExportsService.assertCanRequest`, runner trong
  `apps/worker/src/exports/runners.ts` lấy dữ liệu bằng truy vấn đọc của `@app/server`. Mẫu in PDF: tagged template
  `html` trong `apps/worker/src/exports/templates/`. Web: `ExportButton`, trang "Tệp đã xuất".
- Thông báo (spec 003, ADR-0006): loại mới = mục trong `NOTIFICATION_TYPES` + schema dữ liệu
  (`packages/shared/src/notifications.ts`) + mẫu nội dung (`packages/server/src/notifications/templates.ts`) + tham số mẫu
  Zalo (`ZALO_PARAMS`). Người nhận tính theo QUYỀN HIỆN TẠI trong `packages/server`, worker gọi `notify` rồi đẩy job giao.
  Sự kiện đã biết người nhận: API đẩy job `JOBS.notify` sau commit (mẫu: đặt lại mật khẩu trong `users.service.ts`).
  Không gửi email/Zalo trực tiếp.
- Nhập Excel (spec 003): loại mới = mục trong `IMPORT_TYPES` + `IMPORT_ROW_SCHEMAS` (dùng lại schema form)
  (`packages/shared/src/imports.ts`) + kiểm/ghi trong `packages/server/src/imports/definitions.ts`; web gắn `ImportButton`.
  Mẫu: nhập phòng ban.
- Mã chứng từ theo năm (`PR-2026-000001`): `nextDocumentCode(tx, "PREFIX")` (`@app/server`) trong transaction ghi.
- Định dạng hiển thị (web và tệp xuất): `formatVnd`, `formatDateTime`, `formatDate`, `formatBytes` từ `@app/shared`.

<!-- sample:begin -->

## Mẫu nghiệp vụ: copy theo module `apps/api/src/modules/purchase-requests/`

- `state-machine.ts`: bảng chuyển trạng thái tường minh + hàm thuần `decide()`; ai được làm gì khai báo bằng quyền;
  test từng quy tắc BR-xx.
- `packages/server/src/purchase-requests/`: `policy.ts` (phạm vi xem theo quyền, áp ở tầng query, ngoài phạm vi nhận 404) và `queries.ts` (truy vấn đọc dùng chung cho màn hình và xuất file).
- `*.service.ts`: ghi trong `db.transaction`, khóa dòng `.for("update")`, kiểm `version`, `writeAudit(tx, ...)` cùng transaction,
  đẩy job SAU commit.
- `*.controller.ts`: mỏng, `@RequirePermission(...)`, input qua `new ZodPipe(schemaTừShared)`, user qua `@CurrentUser()`.

Module mẫu chỉ để học: trước module thật đầu tiên, chạy `pnpm sample:remove` (commit riêng).
<!-- sample:end -->
<!-- sample:after-remove
## Mẫu nghiệp vụ

Module mẫu đã gỡ. Khuôn module: `state-machine.ts` (bảng chuyển trạng thái + `decide()` thuần, quyền theo khai báo),
`packages/server/src/<module>/` (`policy.ts` phạm vi xem ở tầng query, `queries.ts` dùng chung màn hình và xuất file),
`*.service.ts` (transaction, `.for("update")`, `version`, `writeAudit`, đẩy job sau commit), `*.controller.ts` mỏng.
Xem module nghiệp vụ đã có của dự án, hoặc mẫu gốc trong lịch sử git trước commit gỡ mẫu.
-->

## Quy ước bắt buộc

1. Import tương đối trong api/worker/packages phải có đuôi `.js` (ESM NodeNext).
2. Input ở mọi biên (HTTP, job, webhook) validate bằng Zod schema trong `packages/shared`. Không định nghĩa schema lần hai ở FE.
3. Lỗi nghiệp vụ: `throw new BusinessError("MODULE_REASON", "thông báo tiếng Việt", status)`. Không throw Error chung chung.
4. Đổi trạng thái chỉ qua state machine; không update cột `status` trực tiếp.
5. Tiền: số nguyên VND (`bigint` mode number), nhập qua `vndSchema`, tổng/thành tiền kiểm bằng `isValidVnd` (`@app/shared`).
   Thời gian: lưu UTC, hiển thị `Asia/Ho_Chi_Minh`.
6. Không hard-code secret; env mới phải thêm vào schema env (`apps/api/src/config/env.ts`) và `.env.example`.
7. Endpoint công khai phải gắn `@Public()` và có lý do trong spec.
8. Không kiểm tên vai trò trong mã. Không thêm cột/enum vai trò. Quyền mới: thêm vào danh mục, có nhãn tiếng Việt.

## Quy trình làm việc

- Yêu cầu mới chưa có spec: `/business-flow`, dừng lại chờ duyệt.
- Có spec đã duyệt: `/feature docs/specs/NNN-xxx.md` (lát cắt dọc: schema -> service + test -> controller -> UI -> E2E).
- Nâng bản kit (sau khi đã chạy `kit-sync`, có `docs/kit-sync/*.md`): `/kit-upgrade`.
- Đổi schema DB: theo `/db-migration`. Đụng auth, phân quyền, upload, xuất dữ liệu: chạy `/security-audit`.
- Không tự thêm thư viện; cần thì nêu lý do và chờ đồng ý. Không sửa ngoài phạm vi task, thấy vấn đề thì ghi cuối báo cáo.
- Không chắc về nghiệp vụ: hỏi, không đoán.

## Ngôn ngữ

Spec, tài liệu, UI, thông báo lỗi cho người dùng, tên test: tiếng Việt có dấu.
Tên biến, hàm, bảng, cột, mã lỗi, commit message (Conventional Commits): tiếng Anh.

## Báo cáo khi xong

Ngắn gọn: đã làm gì, file chính, cách kiểm tra, rủi ro còn lại.
