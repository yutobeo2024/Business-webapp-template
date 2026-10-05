import { html, type SafeHtml } from "@app/server";
import { formatDateTime } from "@app/shared";
import { BASE_CSS } from "./base.js";

/**
 * Mẫu PDF tối thiểu của LÕI, chỉ để kiểm Chromium + font tiếng Việt chạy được (test tích hợp, smoke test image worker
 * trong CI). Không phải mẫu nghiệp vụ: module thêm mẫu in riêng theo cách viết này.
 */
export function pdfCheckHtml(printedAt: Date, note = "Kiểm tra in PDF: tiếng Việt có dấu đầy đủ."): SafeHtml {
  return html`<!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <title>Kiểm tra in PDF</title>
        <style>
          ${BASE_CSS}
        </style>
      </head>
      <body>
        <h1>KIỂM TRA IN PDF</h1>
        <p class="center">${note}</p>
        <table class="grid">
          <tr>
            <th>Chữ có dấu</th>
            <td>Ắ Ằ Ẳ Ẵ Ặ ắ ằ ẳ ẵ ặ Ố Ồ Ổ Ỗ Ộ ố ồ ổ ỗ ộ Ứ Ừ Ử Ữ Ự ứ ừ ử ữ ự đ Đ</td>
          </tr>
        </table>
        <p class="muted small">In lúc ${formatDateTime(printedAt)}</p>
      </body>
    </html>`;
}
