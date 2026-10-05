---
name: upgrade-deps
description: Nâng cấp dependency an toàn theo từng nhóm, đọc changelog phiên bản major, chạy đủ kiểm tra. Dùng khi có cảnh báo lỗ hổng, PR Dependabot bản major, hoặc bảo trì định kỳ.
disable-model-invocation: true
argument-hint: "[tên package | security | all-minor]"
---

# Nâng cấp dependency

Phạm vi: $ARGUMENTS

1. `pnpm outdated -r` và `pnpm audit --prod`. Lập bảng: package, hiện tại, mới nhất, loại (patch/minor/major), có lỗ hổng không.
2. Ưu tiên: lỗ hổng HIGH/CRITICAL trước, rồi patch/minor, major để sau và từng cái một.
3. Với mỗi bản MAJOR: tìm và đọc changelog/migration guide chính thức, liệt kê breaking change ảnh hưởng tới mã của dự án
   (grep nơi dùng). Kiểm peer dependency (ví dụ typescript-eslint hỗ trợ dải TypeScript nào).
4. Trình bày kế hoạch theo nhóm, chờ người dùng đồng ý (lệnh `pnpm add` cần người dùng duyệt).
5. Sau mỗi nhóm: `pnpm install`, `pnpm build`, `pnpm verify:quick`, `pnpm test:integration`. Đỏ thì sửa hoặc lùi nhóm đó.
6. Đổi phiên bản Node, PostgreSQL, Redis, pnpm, image Docker: cập nhật đồng bộ `.nvmrc`, `package.json` (engines, packageManager),
   `infra/docker/*.Dockerfile`, `infra/compose.*.yml`, `.github/workflows/*.yml`, và ghi ADR trong `docs/adr/`.
   `infra/` và `.github/workflows/` bị hook khóa: trình bày thay đổi dạng diff để người dùng tự áp dụng, hoặc người dùng
   mở phiên với `ALLOW_INFRA_EDIT=1`. Image nền và action được ghim theo digest/SHA: lấy giá trị mới từ PR Dependabot,
   không tự gõ digest. `pnpm-lock.yaml` chỉ đổi qua lệnh pnpm.
7. Báo cáo: đã nâng gì, breaking change đã xử lý, còn gì để lại và vì sao.
