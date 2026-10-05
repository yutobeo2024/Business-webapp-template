#!/usr/bin/env bash
# Điều kiện kiểm viết trong nháy đơn và được eval trong check(): biến mở rộng lúc kiểm, không phải lúc khai báo.
# shellcheck disable=SC2016,SC2034
# Kiểm hành vi script vận hành trong infra/ bằng docker, curl giả (không cần Docker daemon, không đụng máy chủ thật).
#   bash tests/infra/run.sh
# Docker giả mô phỏng đúng hành vi đã kiểm trên docker compose 2.39: compose.prod.yml khai báo ${APP_TAG:?}
# nên MỌI lệnh compose (kể cả exec, ps) thất bại khi thiếu APP_TAG.
set -Euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap '[[ -n "${KEEP_WORK:-}" ]] || rm -rf "$WORK"' EXIT
FAILED=0
PASSED=0

ok() { PASSED=$((PASSED + 1)); printf 'ĐÚNG  %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'SAI   %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }

# Nội suy biến thật của compose (chỉ khi máy có docker compose thật).
if docker compose version >/dev/null 2>&1; then
  mkdir -p "$WORK/real"
  cp -r "$ROOT/infra" "$WORK/real/infra"
  printf 'DOMAIN=x\nACME_EMAIL=a@x\nIMAGE_PREFIX=ghcr.io/x/y\nPOSTGRES_USER=app\nPOSTGRES_PASSWORD=p\nPOSTGRES_DB=app\nREDIS_PASSWORD=r\n' \
    >"$WORK/real/infra/.env"
  # shellcheck disable=SC2016
  if env -u APP_TAG bash -c 'source "$1/lib.sh"; "${COMPOSE[@]}" config -q' _ "$WORK/real/infra"; then
    ok "docker compose thật: config hợp lệ khi chưa có APP_TAG"
  else
    fail "docker compose thật: config hợp lệ khi chưa có APP_TAG"
  fi
  # Máy chủ dùng chung: Caddy của app chỉ mở cổng loopback, không chiếm 80/443, dùng Caddyfile.shared.
  shared_cfg="$(printf 'PROXY_MODE=shared\nAPP_LOCAL_PORT=8095\n' >>"$WORK/real/infra/.env"
    env -u APP_TAG bash -c 'source "$1/lib.sh"; load_env; "${COMPOSE[@]}" config' _ "$WORK/real/infra" 2>&1)"
  check "docker compose thật, dùng chung: Caddy chỉ nghe 127.0.0.1:8095" \
    'grep -q "host_ip: 127.0.0.1" <<<"$shared_cfg" && grep -q "published: \"8095\"" <<<"$shared_cfg" && ! grep -qE "published: \"(80|443)\"" <<<"$shared_cfg"'
  check "docker compose thật, dùng chung: Caddy dùng Caddyfile.shared" 'grep -q "Caddyfile.shared" <<<"$shared_cfg"'
  # Cấu hình Caddy hợp lệ ở cả hai chế độ (chỉ khi có docker daemon thật).
  if docker info >/dev/null 2>&1; then
    for f in Caddyfile Caddyfile.shared; do
      img="$(awk '/^  caddy:/{c=1} c && /image:/{print $2; exit}' "$ROOT/infra/compose.prod.yml")"
      check "Caddy validate: $f" \
        'MSYS_NO_PATHCONV=1 docker run --rm -e DOMAIN=app.example.vn -e ACME_EMAIL=a@example.vn \
          -v "$(cd "$ROOT/infra" && pwd -W 2>/dev/null || pwd)/$f:/etc/caddy/Caddyfile:ro" \
          -v "$(cd "$ROOT/infra" && pwd -W 2>/dev/null || pwd)/caddy-app.caddy:/etc/caddy/app.caddy:ro" \
          "$img" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1'
    done
  fi
fi

# Lệnh giả trên PATH.
BIN="$WORK/bin"
mkdir -p "$BIN"
cat >"$BIN/docker" <<'SH'
#!/usr/bin/env bash
echo "APP_TAG=${APP_TAG:-} docker $*" >>"$CALLS"
if [[ "${1:-}" == "compose" ]]; then
  [[ -n "${APP_TAG:-}" ]] || { echo "required variable APP_TAG is missing a value: Thiếu APP_TAG" >&2; exit 1; }
  args=" $* "
  case "$args" in
    *" pg_dump "*) echo "DUMP" ;;
    *" psql "*"notification_deliveries"*) echo "${FAKE_FAILED_DELIVERIES:-0}" ;;
    *" psql "*"integration_tokens"*) echo "${FAKE_ZALO_AGE_H:-1}" ;;
    *" pg_restore "*) cat >/dev/null ;;
    *" run --rm migrate "*) exit "${FAKE_MIGRATE_EXIT:-0}" ;;
    *" ps -q "*) echo "cid-${*: -1}" ;;
  esac
  exit 0
fi
case "${1:-}" in
  inspect) echo "running healthy" ;;
  # Liệt kê image như docker thật: chỉ những image khớp --filter reference=<tiền tố>/*.
  images)
    ref=""
    for a in "$@"; do [[ "$a" == reference=* ]] && ref="${a#reference=}"; done
    printf '%s\n' ${FAKE_IMAGES:-} | while read -r img; do [[ -z "$ref" || "$img" == ${ref%\*}* ]] && echo "$img"; done
    ;;
esac
exit 0
SH
cat >"$BIN/curl" <<'SH'
#!/usr/bin/env bash
exit "${FAKE_HEALTH_EXIT:-0}"
SH
printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/sleep"
# Dung lượng đĩa cố định, không phụ thuộc máy đang chạy test.
printf '#!/usr/bin/env bash\necho "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "/dev/x 100 10 90 10%% /"\n' >"$BIN/df"
# rclone giả: ghi lệnh; lsf liệt kê hai thư mục bản đã xóa (một quá hạn, một hôm nay); sync lỗi theo FAKE_RCLONE_EXIT.
cat >"$BIN/rclone" <<'SH'
#!/usr/bin/env bash
echo "rclone $*" >>"$CALLS"
case "${1:-}" in
  lsf) printf '20200101/\n%s/\n' "$(date -u +%Y%m%d)" ;;
  sync) exit "${FAKE_RCLONE_EXIT:-0}" ;;
esac
exit 0
SH
# Git Bash trên Windows không có flock: dùng bản giả để chạy được ở máy dev (CI Linux dùng flock thật).
command -v flock >/dev/null || printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/flock"
chmod +x "$BIN"/*

# Mỗi tình huống chạy trên một bản sao infra/ riêng (script ghi .deployed-tag, .env cạnh chính nó).
fresh() {
  CASE="$WORK/case-$1"
  rm -rf "$CASE"
  mkdir -p "$CASE/backups"
  cp -r "$ROOT/infra" "$CASE/infra"
  cat >"$CASE/infra/.env" <<ENV
DOMAIN=app.example.vn
POSTGRES_USER=app
POSTGRES_DB=app
IMAGE_PREFIX=ghcr.io/x/y
BACKUP_DIR=$CASE/backups
ENV
  export CALLS="$CASE/calls.log"
  : >"$CALLS"
}
run() { env -u APP_TAG PATH="$BIN:$PATH" CALLS="$CALLS" "$@" >"$CASE/out.log" 2>&1; }
line_of() { grep -n -- "$1" "$CALLS" | head -1 | cut -d: -f1; }

# 1. Sao lưu chạy độc lập (cron 02:00) khi chưa từng deploy, không có APP_TAG.
fresh backup
run bash "$CASE/infra/backup-db.sh" daily
code=$?
check "backup-db.sh chạy được khi không có APP_TAG" '[[ $code -eq 0 ]] && ls "$CASE"/backups/*.dump >/dev/null 2>&1'

# 2. Deploy lần đầu trên máy mới: phải khởi động postgres/redis TRƯỚC khi pg_dump.
fresh first
run bash "$CASE/infra/deploy.sh" v1.0.0
code=$?
check "deploy lần đầu thành công" '[[ $code -eq 0 ]]'
up_line=$(line_of "up -d --wait .*postgres redis")
dump_line=$(line_of "pg_dump")
check "deploy lần đầu: up postgres redis trước pg_dump" '[[ -n "$up_line" && -n "$dump_line" && $up_line -lt $dump_line ]]'
check "deploy lần đầu: ghi .deployed-tag" '[[ "$(cat "$CASE/infra/.deployed-tag" 2>/dev/null)" == v1.0.0 ]]'
check "deploy thành công: báo THÔNG BÁO, không gắn nhãn CẢNH BÁO" \
  'grep -q "THÔNG BÁO: .*Đã deploy v1.0.0" "$CASE/out.log" && ! grep -q "CẢNH BÁO: .*Đã deploy" "$CASE/out.log"'

# 3. Tag độc hại bị từ chối trước mọi lệnh docker.
fresh evil
run bash "$CASE/infra/deploy.sh" "v1';id;'"
code=$?
check "deploy từ chối tag độc hại" '[[ $code -ne 0 && ! -s "$CALLS" ]]'

# 4. Health hỏng sau deploy: tự quay về tag trước.
fresh rollback
echo v1.0.0 >"$CASE/infra/.deployed-tag"
FAKE_HEALTH_EXIT=1 run bash "$CASE/infra/deploy.sh" v1.1.0
code=$?
last_up=$(grep "docker compose .* up -d --remove-orphans" "$CALLS" | tail -1)
pull_line=$(grep "docker compose .* pull " "$CALLS" | head -1)
first_up=$(grep "docker compose .* up -d --remove-orphans --wait" "$CALLS" | head -1)
check "deploy: pull và up dùng tag MỚI" '[[ "$pull_line" == APP_TAG=v1.1.0* && "$first_up" == APP_TAG=v1.1.0* ]]'
check "deploy lỗi health: thoát mã khác 0" '[[ $code -ne 0 ]]'
check "deploy lỗi health: lệnh up cuối dùng tag cũ" '[[ "$last_up" == APP_TAG=v1.0.0* ]]'
check "deploy lỗi health: .deployed-tag giữ tag cũ" '[[ "$(cat "$CASE/infra/.deployed-tag")" == v1.0.0 ]]'

# 4b. Dọn image sau deploy: chỉ image cũ của CHÍNH app; giữ tag mới và tag trước; không đụng image dự án khác.
fresh prune
echo v1.1.0 >"$CASE/infra/.deployed-tag"
FAKE_IMAGES="ghcr.io/x/y/api:v1.0.0 ghcr.io/x/y/api:v1.1.0 ghcr.io/x/y/api:v1.2.0 ghcr.io/x/y/web:v1.0.0 ghcr.io/khac/app:old postgres:17-alpine" \
  run bash "$CASE/infra/deploy.sh" v1.2.0
check "deploy: không dùng docker image prune (xóa image của mọi dự án)" '! grep -q "image prune" "$CALLS"'
check "deploy: xóa image cũ của app" 'grep -q "docker rmi .*ghcr.io/x/y/api:v1.0.0" "$CALLS" && grep -q "docker rmi .*ghcr.io/x/y/web:v1.0.0" "$CALLS"'
check "deploy: giữ tag mới, tag trước và image dự án khác" \
  '! grep "docker rmi" "$CALLS" | sed "s/^APP_TAG=[^ ]* //" | grep -qE "v1\.1\.0|v1\.2\.0|ghcr.io/khac|postgres"'

# 5. alert-check (cron 10 phút) không báo nhầm container chết vì thiếu APP_TAG.
fresh alert
echo v1.0.0 >"$CASE/infra/.deployed-tag"
date +%s >"$CASE/backups/.last-success"
run bash "$CASE/infra/alert-check.sh"
check "alert-check không báo nhầm container không chạy" '! grep -q "không chạy" "$CASE/out.log"'
check "alert-check cảnh báo khi chưa cấu hình sao lưu ra ngoài máy chủ" 'grep -q "BACKUP_REMOTE" "$CASE/out.log"'
echo "BACKUP_REMOTE=offsite:bucket" >>"$CASE/infra/.env"
: >"$CASE/infra/.alert-state"
run bash "$CASE/infra/alert-check.sh"
check "alert-check im lặng khi mọi thứ ổn" '! grep -q "CẢNH BÁO" "$CASE/out.log"'

# 6. Lệnh tay theo runbook qua infra/dc.sh dùng tag đang chạy.
fresh dc
echo v1.0.0 >"$CASE/infra/.deployed-tag"
run bash "$CASE/infra/dc.sh" ps
code=$?
check "dc.sh ps chạy được và dùng tag đang chạy" '[[ $code -eq 0 ]] && grep -q "^APP_TAG=v1.0.0 docker compose .* ps" "$CALLS"'

# 7. Khôi phục: sao lưu trước, rồi pg_restore (không có APP_TAG trong môi trường).
fresh restore
echo v1.0.0 >"$CASE/infra/.deployed-tag"
echo DUMP >"$CASE/backups/old.dump"
echo app | run bash "$CASE/infra/restore-db.sh" "$CASE/backups/old.dump"
code=$?
check "restore-db.sh chạy được khi không có APP_TAG" '[[ $code -eq 0 ]] && grep -q "pg_restore" "$CALLS"'
# pg_restore --clean chỉ xóa object CÓ trong bản sao lưu: bảng sinh sau đó còn lại và làm migration lần sau lỗi.
check "restore-db.sh xóa sạch schema và khôi phục trong một transaction" \
  'grep -q "DROP SCHEMA IF EXISTS public CASCADE" "$CALLS" && grep -q -- "--single-transaction" "$CALLS"'

# 8. Sao lưu tệp: rclone sync giữ bản bị xóa/ghi đè theo ngày, dọn bản quá hạn, ghi mốc thành công.
fresh files
mkdir -p "$CASE/files/2026/10"
echo x >"$CASE/files/2026/10/a"
printf 'FILES_DIR=%s\nBACKUP_REMOTE=offsite:bucket\n' "$CASE/files" >>"$CASE/infra/.env"
run bash "$CASE/infra/backup-files.sh"
code=$?
check "backup-files.sh: rclone sync có --backup-dir theo ngày" \
  '[[ $code -eq 0 ]] && grep -q "^rclone sync $CASE/files offsite:bucket/files/current --backup-dir offsite:bucket/files/deleted/[0-9]\{8\}" "$CALLS"'
check "backup-files.sh: chỉ dọn bản đã xóa quá hạn" \
  'grep -q "^rclone purge offsite:bucket/files/deleted/20200101" "$CALLS" && [[ $(grep -c "^rclone purge" "$CALLS") -eq 1 ]]'
check "backup-files.sh: ghi mốc thành công" '[[ -s "$CASE/backups/.last-success-files" ]]'

fresh files-fail
mkdir -p "$CASE/files"
printf 'FILES_DIR=%s\nBACKUP_REMOTE=offsite:bucket\n' "$CASE/files" >>"$CASE/infra/.env"
FAKE_RCLONE_EXIT=1 run bash "$CASE/infra/backup-files.sh"
code=$?
check "backup-files.sh lỗi: thoát khác 0, có cảnh báo, không ghi mốc" \
  '[[ $code -ne 0 ]] && grep -q "Sao lưu tệp THẤT BẠI" "$CASE/out.log" && [[ ! -e "$CASE/backups/.last-success-files" ]]'

# 9. alert-check cảnh báo khi có thư mục tệp mà chưa sao lưu tệp được.
fresh alert-files
echo v1.0.0 >"$CASE/infra/.deployed-tag"
date +%s >"$CASE/backups/.last-success"
mkdir -p "$CASE/files"
printf 'FILES_DIR=%s\nBACKUP_REMOTE=offsite:bucket\n' "$CASE/files" >>"$CASE/infra/.env"
run bash "$CASE/infra/alert-check.sh"
check "alert-check cảnh báo khi chưa có bản sao lưu tệp" 'grep -q "Chưa có bản sao lưu tệp" "$CASE/out.log"'
date +%s >"$CASE/backups/.last-success-files"
: >"$CASE/infra/.alert-state"
run bash "$CASE/infra/alert-check.sh"
check "alert-check im lặng khi sao lưu tệp còn mới" '! grep -q "CẢNH BÁO" "$CASE/out.log"'

# 10. alert-check cảnh báo thông báo gửi lỗi nhiều, token Zalo không làm mới được.
fresh alert-notify
echo v1.0.0 >"$CASE/infra/.deployed-tag"
date +%s >"$CASE/backups/.last-success"
printf 'BACKUP_REMOTE=offsite:bucket\nZALO_ENABLED=true\n' >>"$CASE/infra/.env"
FAKE_FAILED_DELIVERIES=25 FAKE_ZALO_AGE_H=72 run bash "$CASE/infra/alert-check.sh"
check "alert-check cảnh báo thông báo gửi lỗi nhiều" 'grep -q "25 thông báo email/Zalo gửi lỗi" "$CASE/out.log"'
check "alert-check cảnh báo token Zalo không làm mới được" 'grep -q "Token Zalo chưa làm mới được 72 giờ" "$CASE/out.log"'
: >"$CASE/infra/.alert-state"
FAKE_FAILED_DELIVERIES=3 FAKE_ZALO_AGE_H=5 run bash "$CASE/infra/alert-check.sh"
check "alert-check im lặng khi thông báo ổn" '! grep -q "CẢNH BÁO" "$CASE/out.log"'

# 11. server-setup.sh: máy dùng chung không đụng hệ thống/dịch vụ khác; máy riêng vẫn làm đủ bước.
shared_plan="$(bash "$ROOT/infra/server-setup.sh" --shared --dry-run "ssh-ed25519 AAAA ci" 2>&1)"
full_plan="$(bash "$ROOT/infra/server-setup.sh" --dry-run "ssh-ed25519 AAAA ci" 2>&1)"
check "server-setup --shared: chỉ tạo phần của app" \
  'grep -q "User deploy" <<<"$shared_plan" && grep -q "cron" <<<"$shared_plan"'
check "server-setup --shared: không upgrade, không khởi động lại Docker, không đụng SSH/tường lửa/swap" \
  '! grep -qiE "Cập nhật hệ thống|khởi động lại Docker|Siết SSH|Tường lửa|Swap" <<<"$shared_plan"'
check "server-setup máy riêng: vẫn đủ các bước siết máy" \
  'grep -q "Tường lửa" <<<"$full_plan" && grep -q "Siết SSH" <<<"$full_plan" && grep -q "Docker Engine" <<<"$full_plan"'

printf '\ntests/infra: %d đúng, %d sai\n' "$PASSED" "$FAILED"
[[ $FAILED -eq 0 ]]
