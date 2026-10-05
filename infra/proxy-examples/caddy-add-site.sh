#!/usr/bin/env bash
# Thêm site của app vào Caddy SẴN CÓ trên máy dùng chung, an toàn cho các site khác. Chạy bằng root:
#   bash caddy-add-site.sh <tệp site .caddy> <Caddyfile đang chạy> [EnvironmentFile của dịch vụ caddy] [site để kiểm...]
# Lấy hai đường dẫn từ `systemctl cat caddy` (dòng ExecStart --config và EnvironmentFile); có máy KHÔNG dùng
# /etc/caddy/Caddyfile. Trình tự: sao lưu -> thêm MỘT dòng import -> validate (với đúng biến môi trường) -> reload nóng;
# Caddy chạy "admin off" thì không reload được, chuyển sang restart (mọi site ngắt 1-3 giây). Lỗi thì khôi phục bản cũ.
set -Eeuo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "Cần root"; exit 1; }
SITE_FILE="${1:?Thiếu tệp site}"; CADDYFILE="${2:?Thiếu Caddyfile đang chạy}"; ENVFILE="${3:-}"; shift 3 || shift $#
SITES=("$@")
DEST="/etc/caddy/$(basename "$SITE_FILE")"

check_sites() {
  for s in "${SITES[@]}"; do
    printf '  %-32s %s\n' "$s" "$(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$s:443:127.0.0.1" "https://$s/" || echo LỖI)"
  done
}
# shellcheck disable=SC1090 # EnvironmentFile do người chạy truyền vào
caddy_env() { (set -a; [[ -n "$ENVFILE" ]] && . "$ENVFILE"; set +a; caddy "$@" --config "$CADDYFILE" --adapter caddyfile); }

echo "== Site khác TRƯỚC"; check_sites
install -m 644 "$SITE_FILE" "$DEST"
BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CADDYFILE" "$BACKUP"
grep -qF "import $DEST" "$CADDYFILE" || printf '\nimport %s\n' "$DEST" >> "$CADDYFILE"
restore() { cp -p "$BACKUP" "$CADDYFILE"; echo "LỖI: $1. Đã khôi phục $CADDYFILE"; }

if ! caddy_env validate >/tmp/caddy-validate.log 2>&1; then restore "cấu hình không hợp lệ (/tmp/caddy-validate.log)"; exit 1; fi
if caddy_env reload >/dev/null 2>&1; then
  echo "== Đã reload nóng"
else
  echo "== Không reload nóng được (thường do 'admin off'): restart caddy"
  if ! systemctl restart caddy || ! sleep 3 || ! systemctl is-active --quiet caddy; then
    restore "caddy không lên với cấu hình mới"; systemctl restart caddy; exit 1
  fi
fi
sleep 2
echo "== Site khác SAU (phải giống trước)"; check_sites
echo "XONG. Bản sao cấu hình trước khi sửa: $BACKUP"
