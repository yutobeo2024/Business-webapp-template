---
name: kit-upgrade
description: Hoàn tất nâng cấp dự án lên bản business-webapp-kit mới sau khi đã chạy kit-sync (giải xung đột, sinh migration, kiểm tra). Dùng khi có docs/kit-sync/<từ>-<lên>.md mới hoặc người dùng nói "nâng kit", "cập nhật kit".
argument-hint: "[docs/kit-sync/<từ>-<lên>.md]"
---

# Nâng cấp kit cho dự án

Đầu vào: $ARGUMENTS (mặc định: báo cáo mới nhất trong `docs/kit-sync/`).

Phần cơ học đã do `node <kit>/scripts/kit-sync.mjs <dự án>` làm trên nhánh `kit-sync/<từ>-<lên>`: tệp dự án chưa sửa
đã lấy bản kit, tệp cả hai cùng sửa đã trộn ba chiều, còn lại dấu xung đột. Việc của skill này là phần cần hiểu mã.

## 0. Điều kiện

- Đang ở nhánh `kit-sync/...`, có báo cáo `docs/kit-sync/<từ>-<lên>.md`. Không có thì dừng, nhờ người chạy `kit-sync`.
- Đọc hết báo cáo, nhất là mục "Ghi chú các bản kit ở giữa" (thay đổi phá tương thích, bước nâng cấp tay).

## 1. Giải xung đột (mục "Còn xung đột")

Mỗi tệp có khối `<<<<<<< du-an` ... `=======` ... `>>>>>>> kit-<lên>`. Nguyên tắc:

- **Lõi theo kit**: phần thuộc lõi (quản trị, phân quyền, tệp, xuất, thông báo, nhập, hook, CI, script) lấy bản kit; kit
  sửa lỗi hoặc đổi cách làm thì dự án theo.
- **Nghiệp vụ của dự án giữ nguyên**: đăng ký module của dự án (quyền, loại thông báo/xuất/nhập, route, vai trò mặc
  định, bảng) phải còn đủ sau khi trộn.
- **Trùng ý**: dự án đã tự làm thứ kit nay có sẵn (ví dụ bộ đếm mã chứng từ, phiên đăng nhập E2E dùng lại) thì chuyển
  module sang dùng bản lõi, xóa bản tự làm, trừ khi bản dự án có hành vi nghiệp vụ mà lõi không có (khi đó giữ, ghi lý do
  vào báo cáo).
- **Test lõi** (`apps/api/test/*.int.spec.ts` lõi, test trong `apps/worker/src` của lõi): lấy bản kit; test riêng của
  module dự án giữ. Fixture dùng chung (`test/helpers.ts`, `testing/fixture.ts`): bản kit + phần module dự án cần.
- Không biết bên nào đúng: hỏi người, không đoán. Giải xong tìm lại toàn dự án: không còn `<<<<<<<`, `>>>>>>>`.

Tệp trong mục "Tệp bảo vệ xung đột" (hook, settings, infra, workflow): KHÔNG sửa (hook chặn); ghi vào danh sách cho người.

## 2. Phụ thuộc và DB

1. `pnpm install` (lockfile sinh lại theo package.json đã trộn).
2. Migration: theo mục "Migration của kit" trong báo cáo. `pnpm build` rồi
   `pnpm db:generate --name kit_<lên>`; đọc SQL sinh ra: chỉ được thay đổi đúng phần schema lõi vừa trộn, KHÔNG có DROP
   bảng/cột nghiệp vụ của dự án (có thì schema trộn sai, sửa schema). Chép phần "SQL dữ liệu cần port" vào migration mới
   nếu còn áp dụng (đổi tên bảng/cột cho khớp dự án). Theo `/db-migration` cho mọi thứ phá tương thích.
3. `pnpm db:reset-local` (DB test). DB dev: xin người chạy `pnpm db:migrate` (hoặc `pnpm db:reset-local dev` nếu dữ liệu
   dev bỏ được).

## 3. Kiểm tra

`pnpm format` (tệp trộn chưa được format; CI chạy `format:check`), `node scripts/check-migrations.mjs` (luật mới của
kit có thể bắt migration CŨ của dự án: chưa phát hành thì thêm dòng `-- contract: <lý do>`, đã phát hành thì hỏi
người), `pnpm verify:quick`, `pnpm test:integration`,
`pnpm test:e2e` (cần DB dev đã migrate), `pnpm claude:selftest`. Đỏ thì sửa
theo nguyên tắc ở mục 1, không xóa hay `.skip` test.

## 4. Báo cáo và dừng

- Đã giải những tệp nào, chỗ nào chọn theo dự án thay vì kit và vì sao, bản tự làm nào đã thay bằng lõi.
- Việc cho người: biến `.env` mới (theo ghi chú CHANGELOG; không tự sửa `.env`), tệp bảo vệ cần trộn tay, lệnh DB cần
  chạy, câu hỏi còn mở.
- Không tự commit nếu chưa được phép; message gợi ý: `chore: nâng business-webapp-kit <từ> lên <lên>`.
