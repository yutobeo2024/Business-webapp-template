---
paths:
  - "infra/**"
  - ".github/**"
---

# Hạ tầng và CI/CD

- File trong `infra/` và `.github/workflows/` bị hook khóa. Đề xuất thay đổi dạng diff để người dùng duyệt,
  hoặc người dùng mở phiên với `ALLOW_INFRA_EDIT=1`.
- Script shell: `set -Eeuo pipefail`, dùng hàm trong `infra/lib.sh`, phải sạch `shellcheck -x`.
- Workflow phải sạch `actionlint`. Secret chỉ qua `secrets.*`, không in ra log.
- Biến môi trường production mới: thêm vào `infra/.env.example` kèm chú thích, và vào runbook liên quan.
- Không bao giờ chạy `deploy.sh`, `restore-db.sh` từ phiên AI.
