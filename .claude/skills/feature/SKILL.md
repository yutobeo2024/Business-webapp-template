---
name: feature
description: Triển khai tính năng từ spec đã duyệt theo lát cắt dọc (schema, service + test, controller, UI, E2E) với điều kiện hoàn thành rõ ràng. Dùng khi bắt đầu code một tính năng hoặc module nghiệp vụ.
argument-hint: "<docs/specs/NNN-xxx.md> [phần cần làm]"
---

# Triển khai tính năng theo lát cắt dọc

Spec: $ARGUMENTS

## 0. Điều kiện

Spec phải "Đã duyệt". Chưa thì dừng, đề nghị `/business-flow` hoặc duyệt spec.

## 1. Kế hoạch (chưa code)

<!-- sample:begin -->

- Module thật ĐẦU TIÊN của dự án: lát 0 là `pnpm sample:remove` (gỡ module mẫu, commit riêng) TRƯỚC khi viết code; sau
  đó `pnpm db:migrate`, `pnpm db:reset-local`. Đọc module mẫu `apps/api/src/modules/purchase-requests/` để học cách viết
  trước khi gỡ (sau đó vẫn xem được trong git).

<!-- sample:end -->

- Đọc spec, `CLAUDE.md`, module liên quan, và module nghiệp vụ đã có của dự án làm khuôn.
- Chia lát cắt theo HÀNH VI người dùng thấy được end-to-end ("lập phiếu nháp", "gửi duyệt", "duyệt/từ chối"), không chia theo tầng.
- Mỗi lát ghi: file tạo/sửa, migration (nếu có), test sẽ viết (cả E2E nếu lát có giao diện), BR/AC đáp ứng. Trình bày,
  chờ người dùng đồng ý.

## 2. Mỗi lát cắt

1. Zod schema + type trong `packages/shared`. Lát cắt đầu của module mới: khai báo quyền (`XXX_PERMISSIONS`, nhãn tiếng
   Việt) và đăng ký vào `PERMISSIONS`; đề xuất vai trò mặc định trong `apps/api/src/auth/default-roles.ts`. Đổi
   `DEFAULT_ROLES` thì chạy `pnpm db:seed -- --sync-default-roles` cho DB dev đã seed (không thì vai trò cũ thiếu quyền
   mới); thêm tài khoản demo trong `apps/api/src/cli/seed.ts` và `e2e/users.ts`.
2. Đổi schema DB thì theo `/db-migration`. Mã chứng từ (`XX-2026-000001`) dùng `nextDocumentCode`, không tự tạo sequence.
3. State machine/policy (hàm thuần) + unit test cho từng BR, kể cả trường hợp bị chặn. Viết test trước, code sau.
4. Service (transaction, khóa dòng, version, audit) + test tích hợp trên DB thật (`apps/api/test/`, fixture riêng của
   module, `makeUser` trong `test/helpers.ts`).
5. Controller (`@RequirePermission`, ZodPipe, CurrentUser). Module mới thì đăng ký vào `app.module.ts`.
6. UI: hook trong `features/<module>/api.ts`, trang, form, đủ trạng thái tải/rỗng/lỗi. Danh sách theo mẫu danh sách
   (rule frontend); route mới thêm vào `router.tsx` và menu `NAV` kèm quyền.
7. Spec có đính kèm hoặc xuất Excel/PDF: dùng lõi tệp và xuất file (spec 002), không tự viết; tệp phải giữ lâu (chứng từ)
   thì khai báo trong `FILE_RETENTION`. Truy vấn đọc mà worker cũng cần đặt trong `packages/server`. Spec có báo tin
   (email, Zalo, trong app) hoặc nhập Excel: dùng lõi thông báo và lõi nhập (spec 003).
8. Lát có giao diện: E2E tối thiểu cho luồng của lát chạy NGAY trong lát (`e2e/<module>.spec.ts`, `pageAs("vai-tro")` từ
   `e2e/users.ts`, không đăng nhập lại từng test, không bấm Đăng xuất). Không dồn E2E về cuối module.
9. Khi đang sửa, chạy test theo tệp (`pnpm --filter @app/api exec vitest run --config vitest.integration.config.ts
test/<tệp>`); cuối lát chạy toàn bộ một lần: `pnpm verify:quick`, `pnpm test:integration`, `pnpm test:e2e`. Xanh mới
   sang lát tiếp. DB test bẩn hoặc lệch migration: `pnpm db:reset-local`.
10. Commit mỗi lát. Không commit được (thiếu quyền, hook chặn) thì để thay đổi trong staging và báo lại; KHÔNG ghi tệp
    tạm, bản vá hay log ra ngoài thư mục dự án.

## 3. Hoàn thành khi

- Mọi AC trong phạm vi có test tương ứng và xanh (cả `pnpm test:integration` và `pnpm test:e2e`).
- Không còn TODO, console.log, code chết. Không thêm thư viện chưa được duyệt.
- Đã chạy subagent `code-reviewer` và sửa hết mục CHẶN MERGE. Đụng phân quyền, tệp, xuất dữ liệu: `/security-audit`.
- Báo cáo: lát đã xong, AC đã đáp ứng, việc còn lại, rủi ro.
