/**
 * Mã chứng từ dạng `<TIỀN TỐ>-<NĂM>-<SỐ 6 CHỮ SỐ>`, đánh lại từ 000001 mỗi năm theo giờ Việt Nam (kế toán Việt Nam đánh
 * số chứng từ theo năm). Một hàng bộ đếm cho mỗi (tiền tố, năm), tăng nguyên tử trong transaction của nơi gọi: hai phiếu
 * tạo song song không trùng số, transaction lỗi thì số được trả lại (không nhảy số).
 * Dùng cho mọi module có mã chứng từ, ví dụ `nextDocumentCode(tx, "PR")` -> `PR-2026-000001`.
 */
import { sql } from "drizzle-orm";
import { documentCounters, type DbOrTx } from "@app/db";
import { businessYear } from "@app/shared";

export async function nextDocumentCode(tx: DbOrTx, prefix: string, now = new Date()): Promise<string> {
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(prefix)) throw new Error(`Tiền tố mã chứng từ không hợp lệ: ${prefix}`);
  const year = businessYear(now);
  const [row] = await tx
    .insert(documentCounters)
    .values({ prefix, year, last: 1 })
    .onConflictDoUpdate({
      target: [documentCounters.prefix, documentCounters.year],
      set: { last: sql`${documentCounters.last} + 1` },
    })
    .returning({ last: documentCounters.last });
  return `${prefix}-${year}-${String(row!.last).padStart(6, "0")}`;
}
