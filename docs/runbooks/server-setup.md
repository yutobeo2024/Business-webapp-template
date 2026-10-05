# Dựng máy chủ production (hoặc staging)

1. VPS Ubuntu 24.04, tối thiểu 2 vCPU/4 GB (khuyến nghị 4 vCPU/8 GB). Trỏ DNS bản ghi A của tên miền về IP máy chủ.
2. Trên máy của bạn, tạo cặp khóa riêng cho CI: `ssh-keygen -t ed25519 -f deploy_key -C ci@github -N ""`.
3. Đảm bảo `/root/.ssh/authorized_keys` có khóa quản trị của bạn (script chỉ tắt đăng nhập mật khẩu khi có khóa này).
4. Copy `infra/server-setup.sh` lên máy chủ, chạy bằng root: `bash server-setup.sh "$(cat deploy_key.pub)"`.
5. Đăng nhập user `deploy`:
   - Tạo `/opt/app/infra/.env` từ `infra/.env.example`, sinh secret bằng `openssl rand -hex 32`, rồi `chmod 600`.
     Không dùng `-base64`: ký tự `/`, `+` trong mật khẩu làm hỏng `DATABASE_URL` và `REDIS_URL`.
   - `rclone config` tạo remote cho `BACKUP_REMOTE` (S3/Google Drive/máy chủ khác), bọc bằng remote `crypt` để mã hóa (bắt buộc, xem backup-restore.md).
   - `docker login ghcr.io` bằng token chỉ có quyền `read:packages`.
6. Trên GitHub, Settings > Environments > production (và staging), thêm secret:
   `DEPLOY_HOST`, `DEPLOY_USER=deploy`, `DEPLOY_SSH_KEY` (nội dung `deploy_key`),
   `DEPLOY_KNOWN_HOSTS` (kết quả `ssh-keyscan -t ed25519 <host>`). Production: bật Required reviewers.
7. Deploy lần đầu: push tag (production) hoặc merge vào main (staging). Sau đó seed tài khoản quản trị:
   `cd /opt/app && infra/dc.sh --profile tools run --rm migrate node dist/cli/seed.js`
   (lệnh dùng image api; xóa `SEED_ADMIN_PASSWORD` khỏi `.env` và đổi mật khẩu sau khi đăng nhập lần đầu).
8. Chạy tay `infra/backup-db.sh` một lần và `infra/restore-drill.sh` một lần để xác nhận sao lưu hoạt động.
9. Dựng giám sát ngoài theo [monitoring.md](monitoring.md).
