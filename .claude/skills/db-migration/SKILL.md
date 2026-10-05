---
name: db-migration
description: Thay đổi schema PostgreSQL an toàn cho production theo mô hình expand/contract với Drizzle. Dùng khi thêm, đổi, xóa bảng, cột, index, enum.
---

# Migration an toàn

1. **Phân loại.**
   - An toàn (1 bước): thêm bảng, thêm cột nullable hoặc có default, thêm index trên bảng nhỏ, thêm giá trị enum.
   - Nguy hiểm (2 bước): đổi tên, đổi kiểu, xóa cột/bảng, thêm NOT NULL cho cột đã có dữ liệu, thêm index trên bảng lớn.
2. **Nguy hiểm thì tách release.** Vì rollback chỉ quay image, không đảo migration:
   - Release N (expand): thêm cấu trúc mới; code ghi cả cũ và mới; backfill bằng job theo lô, idempotent.
   - Release N+1 (contract): bỏ cấu trúc cũ khi đã xác nhận dữ liệu chuyển xong.
     Ghi kế hoạch hai bước vào mô tả PR. Migration contract phải có dòng đầu
     `-- contract: <release đã ngừng dùng cấu trúc cũ, lý do>`; thiếu dòng này CI chặn (`scripts/check-migrations.mjs`).
     Không thêm dòng đó để lách khi release trước còn đọc/ghi cấu trúc cũ.
3. **Sinh migration.** Sửa `packages/db/src/schema.ts` rồi `pnpm db:generate --name <ten_mo_ta>`.
   SQL tùy chỉnh: `pnpm --filter @app/db exec drizzle-kit generate --custom --name <ten>`, điền file mới tạo.
   Index trên bảng lớn: migrator chạy mọi migration trong MỘT transaction, nên `CONCURRENTLY` trong migration luôn lỗi.
   Làm hai phần: (a) ghi vào mô tả PR lệnh `CREATE INDEX CONCURRENTLY IF NOT EXISTS <ten> ON ...` để người vận hành
   chạy tay trên production TRƯỚC khi deploy; (b) migration chứa `CREATE INDEX IF NOT EXISTS <ten> ON ...` cùng tên
   (môi trường đã tạo trước thì no-op, môi trường mới/dev thì tạo bình thường).
4. **Đọc SQL sinh ra.** Có DROP ngoài ý muốn? Có khóa bảng lâu? Đổi tên cột có bị sinh thành DROP + ADD (mất dữ liệu)?
5. **Kiểm.** `pnpm build && pnpm db:migrate` trên DB dev; `pnpm test:integration`.
   Cần sửa migration CHƯA commit mà đã áp vào DB cục bộ: xóa file `.sql` đó, xóa snapshot và mục tương ứng trong
   `packages/db/migrations/meta/` (`NNNN_snapshot.json`, mục cuối của `_journal.json`), sửa schema, sinh lại, rồi
   `pnpm build && pnpm db:reset-local` (DB test) và `pnpm db:reset-local dev` (DB dev, mất dữ liệu dev). Đừng sửa tay
   SQL đã áp: DB cục bộ sẽ lệch migration mà không báo.
6. **Báo cáo:** loại thay đổi, cần downtime không, rollback thế nào, bước contract (nếu có) để ở release nào.

Không sửa migration đã commit (hook chặn). Không dùng `drizzle-kit push`.
