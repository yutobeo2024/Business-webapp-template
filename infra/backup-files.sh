#!/usr/bin/env bash
# Sao lưu thư mục tệp (đính kèm, tệp xuất) ra ngoài máy chủ bằng rclone sync.
#   infra/backup-files.sh
# Bản bị xóa hoặc ghi đè trên đích được giữ trong files/deleted/<ngày> (khôi phục khi xóa nhầm), dọn sau
# FILES_BACKUP_KEEP_DAYS ngày. Cron do server-setup.sh cài: 02:30 hằng ngày (sau sao lưu DB).
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env

SRC="${FILES_DIR:-/opt/app-data/files}"
STATE_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
KEEP_DAYS="${FILES_BACKUP_KEEP_DAYS:-30}"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "FILES_BACKUP_KEEP_DAYS không hợp lệ: $KEEP_DAYS"
[[ -d "$SRC" ]] || die "Không có thư mục tệp $SRC (FILES_DIR)"

if [[ -z "${BACKUP_REMOTE:-}" ]]; then
  # alert-check.sh đã cảnh báo BACKUP_REMOTE trống; không ghi mốc thành công.
  log "CẢNH BÁO: BACKUP_REMOTE trống, tệp chưa được sao lưu ra ngoài máy chủ"
  exit 0
fi

trap 'alert "Sao lưu tệp THẤT BẠI tại dòng $LINENO"' ERR
TODAY=$(date -u +%Y%m%d)
log "Sao lưu tệp $SRC -> $BACKUP_REMOTE/files/current"
rclone sync "$SRC" "$BACKUP_REMOTE/files/current" \
  --backup-dir "$BACKUP_REMOTE/files/deleted/$TODAY" --quiet

# Dọn bản đã xóa quá hạn. Tên thư mục là ngày YYYYMMDD nên so sánh chuỗi là so sánh ngày.
CUTOFF=$(date -u -d "-$KEEP_DAYS days" +%Y%m%d)
while IFS= read -r dir; do
  day="${dir%/}"
  [[ "$day" =~ ^[0-9]{8}$ ]] || continue
  if [[ "$day" < "$CUTOFF" ]]; then
    rclone purge "$BACKUP_REMOTE/files/deleted/$day" --quiet
  fi
done < <(rclone lsf --dirs-only "$BACKUP_REMOTE/files/deleted/" 2>/dev/null || true)

mkdir -p "$STATE_DIR"
date +%s >"$STATE_DIR/.last-success-files"
log "Xong sao lưu tệp"
