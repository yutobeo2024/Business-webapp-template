#!/usr/bin/env bash
# Kiểm tra sức khỏe máy chủ mỗi 10 phút (cron), gửi cảnh báo khi có vấn đề. Chống spam: cùng một lỗi chỉ báo lại sau 6 giờ.
set -Euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env

DIR="${BACKUP_DIR:-/opt/backups/postgres}"
STATE="$INFRA_DIR/.alert-state"
touch "$STATE"
problems=()

for mount in / /var/lib/docker; do
  [[ -d "$mount" ]] || continue
  used=$(df -P "$mount" | awk 'NR==2 {gsub("%","",$5); print $5}')
  (( used >= 85 )) && problems+=("Ổ đĩa $mount đã dùng ${used}%")
done

if [[ -f "$DIR/.last-success" ]]; then
  age_h=$(( ( $(date +%s) - $(cat "$DIR/.last-success") ) / 3600 ))
  (( age_h > 26 )) && problems+=("Bản sao lưu gần nhất đã ${age_h} giờ")
else
  problems+=("Chưa có bản sao lưu thành công nào")
fi

# Tệp đính kèm/tệp xuất (backup-files.sh): chỉ kiểm khi máy có thư mục tệp và đã cấu hình sao lưu ra ngoài.
if [[ -d "${FILES_DIR:-/opt/app-data/files}" && -n "${BACKUP_REMOTE:-}" ]]; then
  if [[ -f "$DIR/.last-success-files" ]]; then
    age_h=$(( ( $(date +%s) - $(cat "$DIR/.last-success-files") ) / 3600 ))
    (( age_h > 26 )) && problems+=("Bản sao lưu tệp gần nhất đã ${age_h} giờ")
  else
    problems+=("Chưa có bản sao lưu tệp thành công nào")
  fi
fi

# Bản sao lưu chỉ nằm trên chính máy chủ này thì mất máy là mất cả dữ liệu lẫn bản sao lưu.
[[ -n "${BACKUP_REMOTE:-}" ]] || problems+=("BACKUP_REMOTE trống: bản sao lưu chưa được đẩy ra ngoài máy chủ")

if [[ -f "$DIR/.last-drill" ]]; then
  age_d=$(( ( $(date +%s) - $(cat "$DIR/.last-drill") ) / 86400 ))
  (( age_d > 35 )) && problems+=("Đã ${age_d} ngày chưa diễn tập khôi phục thành công")
fi

# Thông báo email/Zalo gửi lỗi nhiều trong 24 giờ (sai cấu hình SMTP, token Zalo hết hạn...).
psql_value() {
  "${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}
failed=$(psql_value "select count(*) from notification_deliveries where status = 'FAILED' and updated_at > now() - interval '24 hours'")
if [[ "$failed" =~ ^[0-9]+$ ]] && (( failed >= ${ALERT_FAILED_DELIVERIES:-20} )); then
  problems+=("${failed} thông báo email/Zalo gửi lỗi trong 24 giờ qua (xem runbook notifications)")
fi
# Zalo: token phải được làm mới hằng ngày; quá 48 giờ không làm mới được là sắp mất kết nối Zalo.
if [[ "${ZALO_ENABLED:-false}" == "true" ]]; then
  age_h=$(psql_value "select coalesce(floor(extract(epoch from now() - max(updated_at)) / 3600), 9999) from integration_tokens where provider = 'zalo_oa'")
  if [[ "$age_h" =~ ^[0-9]+$ ]] && (( age_h > 48 )); then
    problems+=("Token Zalo chưa làm mới được ${age_h} giờ: nạp lại bằng lệnh zalo-token (runbook notifications)")
  fi
fi

for svc in caddy web api worker postgres redis; do
  cid=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null)
  if [[ -z "$cid" ]]; then problems+=("Container $svc không chạy"); continue; fi
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)
  [[ "$st" == running* && "$st" != *unhealthy* ]] || problems+=("Container $svc: $st")
done

app_healthy || problems+=("API không phản hồi /api/health qua HTTPS")

now=$(date +%s)
for p in "${problems[@]}"; do
  key=$(printf '%s' "$p" | sed 's/[0-9]\+/N/g' | sha1sum | cut -c1-12)
  last=$(grep "^$key " "$STATE" | cut -d' ' -f2 || true)
  if [[ -z "$last" ]] || (( now - last > 21600 )); then
    alert "$p"
    grep -v "^$key " "$STATE" > "$STATE.tmp" || true
    echo "$key $now" >> "$STATE.tmp"
    mv "$STATE.tmp" "$STATE"
  fi
done
# Hết lỗi thì xóa trạng thái để lần lỗi sau báo ngay.
(( ${#problems[@]} == 0 )) && : > "$STATE"
exit 0
