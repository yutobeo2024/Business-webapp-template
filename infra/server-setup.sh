#!/usr/bin/env bash
# Chuẩn bị VPS Ubuntu 22.04/24.04 cho production. Chạy MỘT lần bằng root:
#   bash server-setup.sh "<SSH public key của CI (GitHub Actions)>"            máy RIÊNG cho app
#   bash server-setup.sh --shared "<SSH public key của CI>"                    máy DÙNG CHUNG (đã có dịch vụ khác)
#   thêm --dry-run để chỉ in các bước sẽ làm, không đổi gì.
# Máy dùng chung: chỉ tạo phần của app (user deploy, thư mục, cron, logrotate, rclone/jq). KHÔNG apt upgrade, không đổi
# múi giờ, không ghi daemon.json hay khởi động lại Docker (dừng mọi container khác), không siết sshd, không đổi ufw,
# không tạo swap. App chạy sau proxy sẵn có của máy (PROXY_MODE=shared, xem docs/runbooks/server-setup.md).
# Idempotent: chạy lại không hỏng cấu hình.
set -Eeuo pipefail

SHARED=0
DRY=0
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --shared) SHARED=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "Tùy chọn lạ: $1"; exit 1 ;;
  esac
  shift
done
CI_KEY="${1:-}"
[[ "$CI_KEY" == ssh-* ]] || { echo "Dùng: server-setup.sh [--shared] [--dry-run] \"ssh-ed25519 AAAA... ci@github\""; exit 1; }
[[ $DRY -eq 1 || "$(id -u)" -eq 0 ]] || { echo "Cần chạy bằng root (sudo)"; exit 1; }

log() { printf '[setup] %s\n' "$*"; }
# Mỗi bước là một hàm; --dry-run chỉ in tên bước.
step() {
  local title="$1" fn="$2"
  if [[ $DRY -eq 1 ]]; then log "(xem trước) $title"; else log "$title"; "$fn"; fi
}

base_packages() {
  timedatectl set-timezone Asia/Ho_Chi_Minh
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q && apt-get -yq upgrade
  apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades rclone jq
  dpkg-reconfigure -f noninteractive unattended-upgrades
}

shared_packages() {
  # Chỉ cài thứ app cần nếu thiếu; không nâng gói khác (có thể khởi động lại dịch vụ của dự án khác).
  local missing=()
  for p in rclone jq curl; do command -v "$p" >/dev/null || missing+=("$p"); done
  if ((${#missing[@]})); then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q && apt-get install -yq --no-upgrade "${missing[@]}"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Máy dùng chung phải có sẵn Docker và docker compose (không tự cài để tránh đụng dự án khác)"
    exit 1
  fi
  [[ "$(timedatectl show -p Timezone --value 2>/dev/null)" == Asia/Ho_Chi_Minh ]] ||
    log "LƯU Ý: múi giờ máy không phải Asia/Ho_Chi_Minh; giờ cron dưới đây theo múi giờ của máy."
}

docker_engine() {
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
}

deploy_user() {
  id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  touch /home/deploy/.ssh/authorized_keys
  # restrict: khóa CI chỉ chạy lệnh và rsync, không mở terminal, không chuyển tiếp cổng/agent/X11.
  # Ghi lại dòng của khóa này: máy chủ cài từ bản kit cũ có dòng chưa restrict, chạy lại script phải siết được.
  local auth=/home/deploy/.ssh/authorized_keys
  { grep -vF "$CI_KEY" "$auth" || true; echo "restrict $CI_KEY"; } > "$auth.new"
  mv "$auth.new" "$auth"
  chmod 600 "$auth" && chown deploy:deploy "$auth"
}

harden_ssh() {
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
}

firewall() {
  # Lưu ý: cổng Docker publish đi vòng qua ufw. Compose chỉ publish 80/443 của Caddy; Postgres và Redis không publish ra ngoài.
  ufw default deny incoming && ufw default allow outgoing
  ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
  ufw --force enable
  systemctl enable --now fail2ban
}

swap_file() {
  if ! swapon --show | grep -q . && (( $(awk '/MemTotal/ {print $2}' /proc/meminfo) < 8000000 )); then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

app_dirs_cron() {
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
}

if [[ $SHARED -eq 1 ]]; then
  log "Chế độ máy DÙNG CHUNG: chỉ thêm phần của app, không đụng dịch vụ khác"
  step "Gói app cần (rclone, jq, curl) nếu thiếu; kiểm Docker có sẵn" shared_packages
  step "User deploy (chỉ đăng nhập bằng SSH key, thuộc nhóm docker)" deploy_user
  step "Thư mục ứng dụng, sao lưu, cron, logrotate" app_dirs_cron
else
  step "Cập nhật hệ thống, múi giờ, gói cơ bản" base_packages
  step "Cài Docker Engine, cấu hình log, khởi động lại Docker" docker_engine
  step "User deploy (chỉ đăng nhập bằng SSH key, thuộc nhóm docker)" deploy_user
  step "Siết SSH (chỉ khi root đã có SSH key, tránh tự khóa mình ngoài)" harden_ssh
  step "Tường lửa: chỉ mở SSH, 80, 443" firewall
  step "Swap 2G nếu chưa có và RAM dưới 8 GB" swap_file
  step "Thư mục ứng dụng, sao lưu, cron, logrotate" app_dirs_cron
fi

[[ $DRY -eq 1 ]] && exit 0
log "XONG. Việc còn lại (xem docs/runbooks/server-setup.md):"
log "  1. Tạo /opt/app/infra/.env từ .env.example, chmod 600, chown deploy"
log "  2. su - deploy -c 'rclone config' tạo remote cho BACKUP_REMOTE"
log "  3. docker login ghcr.io bằng tài khoản deploy (token chỉ quyền read:packages)"
if [[ $SHARED -eq 1 ]]; then
  log "  4. Máy dùng chung: đặt PROXY_MODE=shared, TRUST_PROXY_HOPS=2 trong .env; cấu hình proxy của máy chuyển"
  log "     DOMAIN tới 127.0.0.1:\${APP_LOCAL_PORT:-8095} (mẫu: infra/proxy-examples/), kiểm tra trước khi reload proxy."
fi
