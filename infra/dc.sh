#!/usr/bin/env bash
# Chạy docker compose production với đúng file, .env và tag đang chạy. Dùng cho lệnh tay trong runbook:
#   infra/dc.sh ps | infra/dc.sh logs --since 30m api | infra/dc.sh exec postgres psql -U app
set -Eeuo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
source "$(dirname "$0")/lib.sh"
load_env
exec "${COMPOSE[@]}" "$@"
