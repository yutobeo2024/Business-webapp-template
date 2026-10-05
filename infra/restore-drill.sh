#!/usr/bin/env bash
# Diễn tập khôi phục: nạp bản sao lưu mới nhất vào một PostgreSQL TẠM, kiểm tra dữ liệu, đo thời gian.
# Không đụng DB production. Cron do server-setup.sh cài: 03:00 ngày 1 hằng tháng.
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env

DIR="${BACKUP_DIR:-/opt/backups/postgres}"
LATEST="$(find "$DIR" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
[[ -n "$LATEST" ]] || { alert "Diễn tập khôi phục: KHÔNG có bản sao lưu nào trong $DIR"; exit 1; }

NAME="restore-drill-$$"
START=$(date +%s)
# -v: xóa cả volume ẩn danh của image postgres, không để lại bản sao dữ liệu production trên đĩa.
trap 'docker rm -fv "$NAME" >/dev/null 2>&1 || true' EXIT
trap 'alert "Diễn tập khôi phục THẤT BẠI với $(basename "$LATEST")"' ERR

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" createdb -U postgres drill
docker exec -i "$NAME" pg_restore -U postgres -d drill --no-owner --exit-on-error < "$LATEST"

q() { docker exec "$NAME" psql -U postgres -d drill -At -c "$1"; }
# Chỉ kiểm bảng LÕI (có ở mọi dự án). Muốn kiểm thêm bảng nghiệp vụ thì thêm truy vấn ở đây.
USERS=$(q "select count(*) from users")
LAST_AUDIT=$(q "select coalesce(max(created_at)::text, 'chưa có') from audit_logs")
[[ "$USERS" -gt 0 ]] || { false; }

ELAPSED=$(( $(date +%s) - START ))
date +%s > "$DIR/.last-drill"
log "Diễn tập OK: $(basename "$LATEST"), ${ELAPSED}s, users=$USERS, audit mới nhất=$LAST_AUDIT"
notify "Diễn tập khôi phục OK trong ${ELAPSED}s (users=$USERS)"
