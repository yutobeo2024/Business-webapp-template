#!/usr/bin/env bash
# Sao lưu PostgreSQL: pg_dump định dạng custom, kiểm tra đọc lại được, checksum, đẩy ra ngoài máy chủ.
#   infra/backup-db.sh [nhãn]      (mặc định nhãn "daily")
# Cron do server-setup.sh cài: 02:00 hằng ngày.
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env

LABEL="${1:-daily}"
valid_label "$LABEL" || die "Nhãn không hợp lệ: $LABEL"
DIR="${BACKUP_DIR:-/opt/backups/postgres}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
FILE="$DIR/${POSTGRES_DB}-$(date -u +%Y%m%dT%H%M%SZ)-${LABEL}.dump"
TMP="$FILE.partial"

trap 'rm -f "$TMP"; alert "Sao lưu DB ($LABEL) THẤT BẠI tại dòng $LINENO"' ERR
umask 077
mkdir -p "$DIR"

log "Sao lưu $POSTGRES_DB -> $FILE"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner > "$TMP"
[[ -s "$TMP" ]] || { false; }
# Bản sao lưu chưa đọc lại được thì coi như không có.
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$TMP" > /dev/null
mv "$TMP" "$FILE"
(cd "$DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  rclone copy "$FILE" "$BACKUP_REMOTE/" --quiet
  rclone copy "$FILE.sha256" "$BACKUP_REMOTE/" --quiet
else
  log "CẢNH BÁO: BACKUP_REMOTE trống, bản sao lưu chỉ nằm trên máy chủ này"
fi

find "$DIR" -maxdepth 1 -name "*.dump*" -mtime "+$KEEP_DAYS" -delete
date +%s > "$DIR/.last-success"
log "Xong: $(du -h "$FILE" | cut -f1)"
