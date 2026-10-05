#!/usr/bin/env bash
# Kiểm THẬT lệnh khôi phục của infra/restore-db.sh trên PostgreSQL 17 (cần Docker daemon; CI chạy ở job integration).
#   bash tests/infra/restore-real.sh
# Lấy đúng đoạn sh -c '...' trong restore-db.sh để chạy, không chép lại: script đổi thì test đổi theo.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SNIPPET="$(awk '/exec -T postgres sh -c .$/{f=1;next} /^. sh "\$POSTGRES_USER"/{f=0} f' "$ROOT/infra/restore-db.sh")"
[[ -n "$SNIPPET" ]] || { echo "Không trích được lệnh khôi phục từ restore-db.sh"; exit 1; }

NAME="restore-real-$$"
WORK="$(mktemp -d)"
trap 'docker rm -fv "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x -e POSTGRES_USER=app -e POSTGRES_DB=app postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" psql -U app -d app -h 127.0.0.1 -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
q() { docker exec "$NAME" psql -U app -d app -At -c "$1"; }
restore() { docker exec -i "$NAME" sh -c "$SNIPPET" sh app app <"$1"; }
FAILED=0
check() { if [[ "$2" == "$3" ]]; then echo "ĐÚNG  $1"; else echo "SAI   $1 (nhận '$2', mong đợi '$3')"; FAILED=1; fi; }

q "create schema drizzle; create table drizzle.m(id int); insert into drizzle.m values (1);
   create table users(id int); insert into users values (1),(2);" >/dev/null
docker exec "$NAME" pg_dump -U app -d app -Fc --no-owner >"$WORK/ok.dump"
# Sau bản sao lưu: migration mới tạo bảng orders, thêm dòng lịch sử migration, thêm dữ liệu.
q "create table orders(id int); insert into drizzle.m values (2); insert into users values (3);" >/dev/null

restore "$WORK/ok.dump"
check "dữ liệu quay về lúc sao lưu" "$(q 'select count(*) from users')" 2
check "lịch sử migration quay về lúc sao lưu" "$(q 'select count(*) from drizzle.m')" 1
check "bảng sinh sau bản sao lưu bị xóa" "$(q "select count(*) from pg_tables where tablename='orders'")" 0

# File hỏng (cắt cụt): phải báo lỗi và KHÔNG đụng vào DB.
head -c 300 "$WORK/ok.dump" >"$WORK/bad.dump"
if restore "$WORK/bad.dump" 2>/dev/null; then code=0; else code=1; fi
check "file hỏng: lệnh báo lỗi" "$code" 1
check "file hỏng: dữ liệu giữ nguyên" "$(q 'select count(*) from users' 2>/dev/null || echo mat)" 2

if [[ $FAILED -ne 0 ]]; then
  echo "restore-real: KHÔNG đạt"
  exit 1
fi
echo "restore-real: đạt"
