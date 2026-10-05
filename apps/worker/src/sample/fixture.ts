/** Dữ liệu cho test của module MẪU phiếu đề nghị (cả thư mục src/sample bị xóa bởi `pnpm sample:remove`). */
import { purchaseRequests, type Db } from "@app/db";
import type { PrStatus } from "@app/shared";

let seq = 0;
export async function makePr(
  db: Db,
  requesterId: string,
  departmentId: string,
  title: string,
  status: PrStatus = "DRAFT",
) {
  const [pr] = await db
    .insert(purchaseRequests)
    .values({
      code: `PR-2026-${String(++seq).padStart(6, "0")}`,
      title,
      items: [{ name: "Giấy A4 <loại 1>", quantity: 2, unitPrice: 90_000 }],
      totalAmount: 180_000,
      departmentId,
      requesterId,
      status,
    })
    .returning();
  return pr!;
}
