#!/usr/bin/env bash
# Khôi phục DB production từ một file sao lưu. GHI ĐÈ dữ liệu hiện tại.
#   infra/restore-db.sh /opt/backups/postgres/<file>.dump
# Luôn sao lưu trạng thái hiện tại trước, nên có thể quay lại nếu khôi phục nhầm.
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env

FILE="${1:-}"
[[ -f "$FILE" ]] || die "Dùng: restore-db.sh <file.dump>"
if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" --quiet) || die "Checksum không khớp, file hỏng"
else
  log "CẢNH BÁO: không có $(basename "$FILE").sha256, KHÔNG kiểm được file có nguyên vẹn không (tải cả file .sha256 từ remote)"
fi

read -r -p "Sẽ GHI ĐÈ database '$POSTGRES_DB' bằng $(basename "$FILE"). Gõ đúng tên database để xác nhận: " CONFIRM
[[ "$CONFIRM" == "$POSTGRES_DB" ]] || die "Đã hủy"

# Dùng chung khóa với deploy.sh: không để một lần deploy chạy migration giữa lúc đang khôi phục.
exec 9>"$INFRA_DIR/.deploy.lock"
flock -n 9 || die "Đang có một lần deploy hoặc khôi phục khác chạy"

bash "$INFRA_DIR/backup-db.sh" "pre-restore"
log "Dừng api và worker"
"${COMPOSE[@]}" stop api worker
trap 'log "Khôi phục lỗi, khởi động lại api/worker"; "${COMPOSE[@]}" start api worker' ERR

# Xóa sạch schema rồi nạp lại, tất cả trong MỘT transaction (lỗi giữa chừng thì DB giữ nguyên như trước).
# Không dùng pg_restore --clean: nó chỉ xóa object CÓ trong bản sao lưu, nên bảng do migration mới hơn tạo ra vẫn còn
# trong khi bảng lịch sử migration (schema drizzle) đã quay về cũ, và lần deploy sau lỗi "already exists".
# Hai bước: (1) chuyển bản sao lưu thành SQL, file hỏng thì dừng TRƯỚC khi đụng DB; (2) xóa + nạp trong một transaction.
# Không nối thẳng pg_restore | psql: pg_restore chết giữa chừng thì psql vẫn commit phần đã nhận, tức DB bị xóa trắng.
# GRANT USAGE: schema public tạo lại mất quyền mặc định, role khác chủ sở hữu (ví dụ role chỉ đọc cho báo cáo) cần lại.
# File SQL trung gian nằm trong /tmp của container (không nén): cần đủ đĩa cho một bản dữ liệu dạng văn bản.
# shellcheck disable=SC2016
"${COMPOSE[@]}" exec -T postgres sh -c '
  set -e
  sql=$(mktemp)
  trap "rm -f \"$sql\"" EXIT
  pg_restore --no-owner -f "$sql"
  psql -U "$1" -d "$2" -q -v ON_ERROR_STOP=1 --single-transaction \
    -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;" \
    -f "$sql"
' sh "$POSTGRES_USER" "$POSTGRES_DB" < "$FILE"

"${COMPOSE[@]}" start api worker
wait_healthy 40 || die "Đã khôi phục nhưng API chưa healthy, kiểm tra log"
log "Khôi phục xong từ $(basename "$FILE")"
notify "Đã khôi phục DB từ $(basename "$FILE")"
