---
name: release
description: Chuẩn bị bản phát hành production (kiểm tra, changelog, version, ghi chú triển khai). Chỉ chạy khi người dùng gọi /release.
disable-model-invocation: true
argument-hint: "<patch|minor|major>"
---

# Chuẩn bị release

Loại version: $ARGUMENTS
Tag gần nhất: !`git describe --tags --abbrev=0 2>/dev/null || echo "chưa có tag"`

1. Nhánh `main`, sạch, đã pull mới nhất. Không đúng thì dừng.
2. `pnpm verify:quick` và `pnpm test:integration` xanh. Đỏ thì dừng.
3. Chạy `/security-audit <tag gần nhất>..HEAD` (chưa có tag thì dùng commit đầu tiên `$(git rev-list --max-parents=0 HEAD)..HEAD`).
   Phải truyền khoảng: đang đứng trên `main` nên mặc định `main...HEAD` là diff rỗng. "CHƯA ĐƯỢC RELEASE" thì dừng.
4. Liệt kê migration mới từ tag trước (`git diff --name-only <tag>..HEAD -- packages/db/migrations`):
   mỗi cái an toàn hay cần downtime, có bước contract treo không. `node scripts/check-migrations.mjs` phải xanh.
5. Cập nhật `CHANGELOG.md` tiếng Việt cho người dùng nghiệp vụ đọc (Thêm mới / Thay đổi / Sửa lỗi), không dán commit message.
6. Tăng `version` ở `package.json` gốc theo $ARGUMENTS. Đề xuất lệnh commit `chore(release): vX.Y.Z` và `git tag vX.Y.Z`
   để người dùng xác nhận.
7. Viết `docs/runbooks/releases/vX.Y.Z.md`: thay đổi chính, biến môi trường mới (đã thêm vào `infra/.env.example` chưa),
   migration, việc kiểm sau deploy, cách rollback (Actions > Rollback, tag trước đó).

Không push, không deploy. Production chỉ deploy khi người dùng push tag và duyệt trong GitHub environment "production".
