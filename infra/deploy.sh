#!/usr/bin/env bash
# Deploy một phiên bản image lên máy chủ production.
#   infra/deploy.sh <tag> [--skip-migrate]
# Trình tự: khóa chống deploy song song -> sao lưu DB -> pull image -> migrate -> khởi động và chờ healthy
#           -> kiểm tra health qua HTTPS -> nếu hỏng, tự quay image về phiên bản trước.
# Rollback chỉ đổi image, KHÔNG đảo migration. Vì vậy migration bắt buộc theo expand/contract (xem skill /db-migration).
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"

NEW_TAG="${1:-}"
SKIP_MIGRATE="${2:-}"
[[ -n "$NEW_TAG" ]] || die "Dùng: deploy.sh <tag> [--skip-migrate]"
valid_label "$NEW_TAG" || die "Tag không hợp lệ: $NEW_TAG"

exec 9>"$INFRA_DIR/.deploy.lock"
flock -n 9 || die "Đang có một lần deploy khác chạy"

load_env
STATE_FILE="$INFRA_DIR/.deployed-tag"
PREV_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"

rollback() {
  local reason="$1"
  if [[ -z "$PREV_TAG" || "$PREV_TAG" == "$NEW_TAG" ]]; then
    alert "Deploy $NEW_TAG THẤT BẠI ($reason). Không có phiên bản trước để quay lại. Xử lý theo docs/runbooks/incident.md"
    exit 1
  fi
  log "Quay image về $PREV_TAG"
  export APP_TAG="$PREV_TAG"
  "${COMPOSE[@]}" up -d --remove-orphans api worker web caddy || true
  if wait_healthy 40; then
    alert "Deploy $NEW_TAG THẤT BẠI ($reason). Đã tự quay về $PREV_TAG, hệ thống hoạt động bình thường."
  else
    alert "Deploy $NEW_TAG THẤT BẠI ($reason) và quay về $PREV_TAG CŨNG LỖI. Cần xử lý ngay: docs/runbooks/incident.md"
  fi
  exit 1
}

log "Bắt đầu deploy $NEW_TAG (đang chạy: ${PREV_TAG:-chưa có})"
# Máy mới chưa có container nào: sao lưu (pg_dump qua exec) cần PostgreSQL đang chạy.
# --no-recreate: container đang chạy giữ nguyên dù compose.prod.yml mới đổi cấu hình, để sao lưu xong rồi mới đổi.
"${COMPOSE[@]}" up -d --wait --no-recreate postgres redis || die "Không khởi động được PostgreSQL/Redis"
bash "$INFRA_DIR/backup-db.sh" "pre-deploy-$NEW_TAG" || die "Sao lưu trước deploy thất bại, dừng deploy"

export APP_TAG="$NEW_TAG"
"${COMPOSE[@]}" pull api worker web || die "Không pull được image $NEW_TAG"

if [[ "$SKIP_MIGRATE" != "--skip-migrate" ]]; then
  log "Chạy migration"
  "${COMPOSE[@]}" --profile tools run --rm migrate || rollback "migration lỗi"
fi

"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180 || rollback "container không healthy"
wait_healthy 40 || rollback "health check qua HTTPS thất bại"

echo "$NEW_TAG" > "$STATE_FILE"
printf '%s %s (trước: %s)\n' "$(date -Is)" "$NEW_TAG" "${PREV_TAG:-none}" >> "$INFRA_DIR/deploy-history.log"
# Dọn image CŨ CỦA APP NÀY (mỗi lần deploy để lại một bộ image, lâu ngày đầy đĩa). Không dùng `docker image prune -a`:
# lệnh đó xóa image không dùng của MỌI dự án trên máy (máy dùng chung sẽ làm dự án khác mất bản để quay lại).
# Giữ tag vừa deploy và tag trước đó (rollback nhanh); quay về tag cũ hơn sẽ tự pull lại từ registry.
docker images --filter "reference=${IMAGE_PREFIX}/*" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null |
  awk -F: -v keep1="$NEW_TAG" -v keep2="${PREV_TAG:-}" '$NF != keep1 && $NF != keep2 && $NF != "<none>"' |
  xargs -r docker rmi >/dev/null 2>&1 || true
log "Deploy $NEW_TAG thành công"
notify "Đã deploy $NEW_TAG thành công"
