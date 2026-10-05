# Deploy và phát hành

**Staging:** mỗi lần merge vào `main`, CI chạy đủ kiểm tra, build image `sha-xxxxxxx`, deploy staging tự động.

**Production:**

1. Trong Claude Code: `/release minor` (hoặc patch/major). Xem lại CHANGELOG và ghi chú `docs/runbooks/releases/vX.Y.Z.md`.
2. Commit, `git tag vX.Y.Z`, `git push origin main --tags` (người làm, không phải AI).
3. GitHub Actions chạy kiểm tra, build image `vX.Y.Z`, chờ người duyệt trong environment production.
4. Duyệt. `deploy.sh` trên máy chủ: sao lưu DB, pull image, migrate, khởi động, chờ healthy, kiểm `/api/health` qua HTTPS.
   Hỏng thì tự quay image về bản trước và gửi cảnh báo.
5. Sau deploy: làm các bước kiểm trong ghi chú release; theo dõi Sentry/cảnh báo 30 phút.

Lịch sử: `/opt/app/infra/deploy-history.log`. Đang chạy: `/opt/app/infra/.deployed-tag`.
Không deploy chiều thứ Sáu hoặc trước ngày nghỉ trừ bản vá khẩn.
