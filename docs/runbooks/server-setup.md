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
6. Trên GitHub, Settings > Environments > production (và staging), thêm secret (lệnh `gh secret set ... --env <tên>`):
   `DEPLOY_HOST`, `DEPLOY_USER=deploy`, `DEPLOY_SSH_KEY` (nội dung `deploy_key`),
   `DEPLOY_KNOWN_HOSTS` (kết quả `ssh-keyscan -t ed25519 <host>`). Production: bật Required reviewers. Lưu ý: repo RIÊNG
   TƯ chỉ có Required reviewers khi tài khoản/tổ chức dùng gói trả phí (Pro, Team...); gói Free thì để production không
   người duyệt và coi việc GẮN TAG (chỉ người có quyền ghi, CI chặn tag không nằm trên main) là bước duyệt.
7. Deploy lần đầu: push tag (production) hoặc merge vào main (staging). Sau đó seed tài khoản quản trị:
   `cd /opt/app && infra/dc.sh --profile tools run --rm migrate node dist/cli/seed.js`
   (lệnh dùng image api; xóa `SEED_ADMIN_PASSWORD` khỏi `.env` và đổi mật khẩu sau khi đăng nhập lần đầu).
8. Chạy tay `infra/backup-db.sh` một lần và `infra/restore-drill.sh` một lần để xác nhận sao lưu hoạt động.
9. Dựng giám sát ngoài theo [monitoring.md](monitoring.md).

## Máy chủ dùng chung (đã có dịch vụ khác, proxy giữ 80/443)

Không chạy bước 4 như trên: chế độ máy riêng nâng cấp toàn bộ gói, khởi động lại Docker (dừng mọi container khác), siết
sshd và đặt lại ufw. Thay bằng:

1. Kiểm trước (chỉ đọc): `ss -tlnp` (ai giữ 80/443), `docker compose ls`, `systemctl cat caddy` hoặc `nginx -T` (cấu hình
   proxy ĐANG chạy), `free -h`, `df -h /`. Cần trống tối thiểu khoảng 2,5 GB RAM (api 768 MB, worker 1 GB khi in PDF,
   Postgres, Redis) và 5 GB đĩa. Chọn `APP_LOCAL_PORT` chưa ai dùng.
2. `bash server-setup.sh --shared --dry-run "$(cat deploy_key.pub)"` xem trước, rồi chạy thật không có `--dry-run`:
   chỉ tạo user `deploy`, thư mục, cron, logrotate, cài `rclone`/`jq` nếu thiếu; yêu cầu Docker có sẵn.
3. `infra/.env`: như bước 5 ở trên, thêm `PROXY_MODE=shared`, `TRUST_PROXY_HOPS=2`, `APP_LOCAL_PORT`. Caddy của app chỉ
   nghe `127.0.0.1:APP_LOCAL_PORT`, không xin chứng chỉ; proxy của máy lo HTTPS.
4. Proxy của máy: thêm site theo `infra/proxy-examples/` (Caddy hoặc nginx), chuyển `DOMAIN` tới
   `127.0.0.1:APP_LOCAL_PORT`. Caddy: dùng `infra/proxy-examples/caddy-add-site.sh` (sao lưu, thêm một dòng `import`,
   validate với đúng biến môi trường, reload nóng; Caddy chạy `admin off` thì không reload được, script restart: mọi site
   ngắt 1-3 giây, nên làm lúc vắng người dùng; lỗi thì tự khôi phục). Lấy tệp cấu hình ĐANG chạy và EnvironmentFile từ
   `systemctl cat caddy`: đừng tin `systemctl reload caddy` khi ExecReload trỏ tệp khác ExecStart. Kiểm các site khác
   trước và sau.
5. Bước 6-9 như trên. Health check của deploy đi qua HTTPS của proxy máy (`https://DOMAIN`), nên proxy phải xong trước
   lần deploy đầu.

Sao lưu ra ngoài: tạo remote rclone (ví dụ `gdrive`, Google Drive phạm vi `drive.file`) rồi remote `crypt` tên `offsite`
trỏ vào THƯ MỤC GỐC của nhà cung cấp (`gdrive:`), và `BACKUP_REMOTE=offsite:<tên-app>`; nếu crypt đã trỏ vào
`gdrive:<thư mục>` thì đặt `BACKUP_REMOTE=offsite:` để khỏi lồng hai lớp thư mục. Lưu hai mật khẩu crypt ngoài máy chủ.
Máy chủ không có trình duyệt: `rclone config` chọn "Use web browser" = n, chạy lệnh `rclone authorize ...` nó in ra trên
máy có trình duyệt, dán kết quả lại; chỉ dán vào máy chủ, không gửi qua kênh chat.

`deploy.sh` chỉ dọn image của chính app (theo `IMAGE_PREFIX`), không `docker image prune -a` (lệnh đó xóa image của mọi dự
án trên máy).
