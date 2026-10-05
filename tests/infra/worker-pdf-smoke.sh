#!/usr/bin/env bash
# Kiểm image worker in được PDF thật: Chromium chạy được (user node, không sandbox), font Noto có đủ dấu tiếng Việt.
#   bash tests/infra/worker-pdf-smoke.sh <image>
# Chạy trong CI trước khi đẩy image worker; chạy tay được ở máy có Docker.
set -Eeuo pipefail

IMAGE="${1:?Cách dùng: worker-pdf-smoke.sh <image>}"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# Mã chạy TRONG image, dùng đúng PdfRenderer và mẫu kiểm tra của lõi (dist đã build; không phụ thuộc module nghiệp vụ).
read -r -d '' SCRIPT <<'JS' || true
const { PdfRenderer } = await import("/app/dist/exports/pdf.js");
const { pdfCheckHtml } = await import("/app/dist/exports/templates/pdf-check.js");
const r = new PdfRenderer(process.env.CHROMIUM_PATH);
const pdf = await r.render(pdfCheckHtml(new Date()));
await r.close();
process.stdout.write(pdf);
JS

docker run --rm --network none --entrypoint node "$IMAGE" --input-type=module -e "$SCRIPT" >"$OUT"

head -c 5 "$OUT" | grep -q '%PDF-' || { echo "SAI: kết quả không phải PDF" >&2; exit 1; }
# Tên font nhúng trong PDF: thiếu fonts-noto-core thì Chromium dùng font khác, dấu tiếng Việt có thể vỡ.
grep -aq 'NotoSans' "$OUT" || { echo "SAI: PDF không nhúng font Noto Sans" >&2; exit 1; }
echo "ĐÚNG  image worker in được PDF ($(wc -c <"$OUT") byte, font Noto Sans)"
