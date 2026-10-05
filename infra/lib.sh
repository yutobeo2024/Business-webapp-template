#!/usr/bin/env bash
# Hàm dùng chung cho các script vận hành. Được source, không chạy trực tiếp.
# shellcheck disable=SC2034

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$INFRA_DIR/compose.prod.yml")
# compose.prod.yml bắt buộc APP_TAG cho MỌI lệnh compose (kể cả exec, ps). Mặc định lấy tag đang chạy để sao lưu,
# cảnh báo, khôi phục và lệnh tay hoạt động; deploy.sh tự export tag mới trước khi pull/up.
export APP_TAG="${APP_TAG:-$(cat "$INFRA_DIR/.deployed-tag" 2>/dev/null || echo none)}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "LỖI: $*" >&2; exit 1; }

load_env() {
  [[ -f "$INFRA_DIR/.env" ]] || die "Không thấy $INFRA_DIR/.env (copy từ .env.example)"
  set -a
  # shellcheck disable=SC1091
  source "$INFRA_DIR/.env"
  set +a
  # Máy chủ dùng chung (đã có proxy giữ 80/443): Caddy của app chỉ nghe loopback (compose.shared.yml).
  if [[ "${PROXY_MODE:-}" == shared && " ${COMPOSE[*]} " != *" $INFRA_DIR/compose.shared.yml "* ]]; then
    COMPOSE+=(-f "$INFRA_DIR/compose.shared.yml")
  fi
}

# Gửi cảnh báo tới ALERT_WEBHOOK_URL (JSON {"text": ...}). Không bao giờ làm script chính thất bại.
send_webhook() {
  [[ -n "${ALERT_WEBHOOK_URL:-}" ]] || return 0
  local payload
  payload=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  curl -fsS -m 10 -H 'Content-Type: application/json' -d "{\"text\":\"$payload\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
# Sự cố cần người xử lý.
alert() {
  local msg="[${DOMAIN:-app}] $*"
  log "CẢNH BÁO: $msg"
  send_webhook "$msg"
}
# Tin bình thường (deploy xong, diễn tập OK): cùng kênh nhưng không gắn nhãn cảnh báo, để cảnh báo thật không bị lẫn.
notify() {
  local msg="[${DOMAIN:-app}] $*"
  log "THÔNG BÁO: $msg"
  send_webhook "$msg"
}

# Kiểm tra API qua Caddy trên chính máy chủ (--resolve tránh lỗi hairpin NAT).
app_healthy() {
  curl -fsS -m 5 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" >/dev/null 2>&1
}

wait_healthy() {
  local tries="${1:-40}"
  for _ in $(seq 1 "$tries"); do
    app_healthy && return 0
    sleep 3
  done
  return 1
}

valid_label() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }
