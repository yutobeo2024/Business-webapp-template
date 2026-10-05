#!/usr/bin/env bash
# Chuẩn bị VPS Ubuntu 22.04/24.04 mới cho production. Chạy MỘT lần bằng root:
#   bash server-setup.sh "<SSH public key của CI (GitHub Actions)>"
# Idempotent: chạy lại không hỏng cấu hình.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Cần chạy bằng root"; exit 1; }
CI_KEY="${1:-}"
[[ "$CI_KEY" == ssh-* ]] || { echo "Dùng: server-setup.sh \"ssh-ed25519 AAAA... ci@github\""; exit 1; }

log() { printf '[setup] %s\n' "$*"; }

log "Cập nhật hệ thống, múi giờ, gói cơ bản"
timedatectl set-timezone Asia/Ho_Chi_Minh
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get -yq upgrade
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades rclone jq
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Cài Docker Engine từ kho chính thức của Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
JSON
systemctl restart docker

log "User deploy (chỉ đăng nhập bằng SSH key, thuộc nhóm docker)"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
# restrict: khóa CI chỉ chạy lệnh và rsync, không mở terminal, không chuyển tiếp cổng/agent/X11.
# Ghi lại dòng của khóa này: máy chủ cài từ bản kit cũ có dòng chưa restrict, chạy lại script phải siết được.
AUTH=/home/deploy/.ssh/authorized_keys
{ grep -vF "$CI_KEY" "$AUTH" || true; echo "restrict $CI_KEY"; } > "$AUTH.new"
mv "$AUTH.new" "$AUTH"
chmod 600 /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys

log "Siết SSH (chỉ khi root đã có SSH key, tránh tự khóa mình ngoài)"
if [[ -s /root/.ssh/authorized_keys ]]; then
  # sshd lấy giá trị ĐẦU TIÊN gặp được và đọc sshd_config.d theo thứ tự tên. Ảnh cloud thường có sẵn
  # 50-cloud-init.conf với "PasswordAuthentication yes", nên file siết phải đứng trước (00-).
  rm -f /etc/ssh/sshd_config.d/90-hardening.conf
  cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
CONF
  sshd -t || { echo "Cấu hình sshd lỗi, KHÔNG reload. Kiểm tra /etc/ssh/sshd_config.d/"; exit 1; }
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  if ! sshd -T 2>/dev/null | grep -qi '^passwordauthentication no'; then
    log "CẢNH BÁO: sshd vẫn cho đăng nhập bằng mật khẩu. Kiểm tra: sshd -T | grep -i passwordauthentication"
  fi
else
  log "BỎ QUA siết SSH: /root/.ssh/authorized_keys trống. Thêm key quản trị rồi chạy lại script."
fi

log "Tường lửa: chỉ mở SSH, 80, 443"
# Lưu ý: cổng Docker publish đi vòng qua ufw. Compose chỉ publish 80/443 của Caddy; Postgres và Redis không publish ra ngoài.
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

if ! swapon --show | grep -q . && (( $(awk '/MemTotal/ {print $2}' /proc/meminfo) < 8000000 )); then
  log "Tạo swap 2G"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Thư mục ứng dụng, sao lưu, cron, logrotate"
install -d -m 750 -o deploy -g deploy /opt/app /opt/app/infra /opt/backups /opt/backups/postgres
# Thư mục tệp (FILES_DIR), mount vào api và worker. Chủ là uid 1000 (user node trong image); setgid nhóm deploy để
# tệp mới thuộc nhóm deploy và backup-files.sh (chạy bằng deploy) đọc được.
install -d -m 750 -o deploy -g deploy /opt/app-data
install -d -m 2750 -o 1000 -g deploy /opt/app-data/files
cat > /etc/cron.d/app <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * *   deploy bash /opt/app/infra/backup-db.sh daily     >> /var/log/app/backup.log 2>&1
30 2 * * *  deploy bash /opt/app/infra/backup-files.sh        >> /var/log/app/backup.log 2>&1
0 3 1 * *   deploy bash /opt/app/infra/restore-drill.sh       >> /var/log/app/restore-drill.log 2>&1
*/10 * * * * deploy bash /opt/app/infra/alert-check.sh        >> /var/log/app/alert-check.log 2>&1
CRON
install -d -m 750 -o deploy -g deploy /var/log/app
cat > /etc/logrotate.d/app <<'ROT'
/var/log/app/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
ROT

log "XONG. Việc còn lại (xem docs/runbooks/server-setup.md):"
log "  1. Tạo /opt/app/infra/.env từ .env.example, chmod 600, chown deploy"
log "  2. su - deploy -c 'rclone config' tạo remote cho BACKUP_REMOTE"
log "  3. docker login ghcr.io bằng tài khoản deploy (token chỉ quyền read:packages)"
