import type { purchaseRequests } from "@app/db";
import { formatDate, formatDateTime, formatVnd, PR_STATUS_LABELS } from "@app/shared";
import { html, type SafeHtml } from "@app/server";
import { BASE_CSS } from "./base.js";

export interface PurchaseRequestPdfData {
  pr: typeof purchaseRequests.$inferSelect;
  requesterName: string;
  departmentName: string;
  printedAt: Date;
}

/** Mẫu in phiếu đề nghị mua hàng. Mọi giá trị chèn qua `html` đều được escape. */
export function purchaseRequestHtml({
  pr,
  requesterName,
  departmentName,
  printedAt,
}: PurchaseRequestPdfData): SafeHtml {
  return html`<!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <title>${pr.code}</title>
        <style>
          ${BASE_CSS}
        </style>
      </head>
      <body>
        <h1>PHIẾU ĐỀ NGHỊ MUA HÀNG</h1>
        <p class="center muted">Số: ${pr.code} · Ngày lập: ${formatDate(pr.createdAt)}</p>

        <table class="info">
          <tr>
            <th>Người đề nghị</th>
            <td>${requesterName}</td>
            <th>Phòng ban</th>
            <td>${departmentName}</td>
          </tr>
          <tr>
            <th>Nội dung</th>
            <td colspan="3">${pr.title}</td>
          </tr>
          <tr>
            <th>Trạng thái</th>
            <td colspan="3">${PR_STATUS_LABELS[pr.status]}</td>
          </tr>
        </table>

        <table class="grid">
          <thead>
            <tr>
              <th class="num">STT</th>
              <th>Tên hàng</th>
              <th class="num">Số lượng</th>
              <th class="num">Đơn giá</th>
              <th class="num">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${pr.items.map(
              (item, i) =>
                html`<tr>
                  <td class="num">${i + 1}</td>
                  <td>${item.name}</td>
                  <td class="num">${item.quantity.toLocaleString("vi-VN")}</td>
                  <td class="num">${formatVnd(item.unitPrice)}</td>
                  <td class="num">${formatVnd(item.quantity * item.unitPrice)}</td>
                </tr>`,
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4" class="num">Tổng cộng</th>
              <th class="num">${formatVnd(pr.totalAmount)}</th>
            </tr>
          </tfoot>
        </table>

        ${pr.note ? html`<p><strong>Ghi chú:</strong> ${pr.note}</p>` : null}
        ${pr.rejectReason ? html`<p><strong>Lý do từ chối:</strong> ${pr.rejectReason}</p>` : null}

        <table class="signatures">
          <tr>
            <td>Người đề nghị</td>
            <td>Trưởng phòng</td>
            <td>Giám đốc</td>
          </tr>
          <tr class="hint">
            <td>(Ký, ghi rõ họ tên)</td>
            <td>(Ký, ghi rõ họ tên)</td>
            <td>(Ký, ghi rõ họ tên)</td>
          </tr>
          <tr class="names">
            <td>${requesterName}</td>
            <td></td>
            <td></td>
          </tr>
        </table>

        <p class="muted small">In lúc ${formatDateTime(printedAt)}</p>
      </body>
    </html>`;
}
