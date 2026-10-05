/**
 * Truy vấn ĐỌC phiếu đề nghị dùng chung cho API (màn danh sách) và worker (xuất Excel/PDF): cùng một hàm thì cùng phạm vi
 * xem, không thể xuất được thứ người dùng không xem được trên màn hình.
 */
import { and, count, eq, isNull, or, type SQL } from "drizzle-orm";
import { purchaseRequests, users, type DbOrTx } from "@app/db";
import type { CurrentUser, ListPurchaseRequestsQuery, Paginated } from "@app/shared";
import { orderBy, pageOffset, paginated, searchCondition } from "../list-query.js";
import { canView, type ViewScope, viewScope } from "./policy.js";

export type PrRow = typeof purchaseRequests.$inferSelect;
export interface PrWithRequester {
  pr: PrRow;
  requesterName: string;
}
type Viewer = Pick<CurrentUser, "id" | "departmentId" | "permissions">;

/** Cột được sắp xếp: khóa khớp `sortable` của listPurchaseRequestsQuerySchema (TypeScript bắt lệch). */
const SORTABLE = {
  createdAt: purchaseRequests.createdAt,
  code: purchaseRequests.code,
  totalAmount: purchaseRequests.totalAmount,
  status: purchaseRequests.status,
} satisfies Record<ListPurchaseRequestsQuery["sort"], unknown>;

export function scopeCondition(scope: ViewScope): SQL | undefined {
  switch (scope.kind) {
    case "all":
      return undefined;
    case "department":
      return or(
        eq(purchaseRequests.departmentId, scope.departmentId),
        eq(purchaseRequests.requesterId, scope.userId),
      );
    case "own":
      return eq(purchaseRequests.requesterId, scope.userId);
  }
}

export async function listPurchaseRequests(
  db: DbOrTx,
  actor: Viewer,
  q: ListPurchaseRequestsQuery,
): Promise<Paginated<PrWithRequester>> {
  const where = and(
    isNull(purchaseRequests.deletedAt),
    scopeCondition(viewScope(actor)),
    q.status ? eq(purchaseRequests.status, q.status) : undefined,
    searchCondition(q.q, [purchaseRequests.code, purchaseRequests.title]),
  );
  const [rows, totals] = await Promise.all([
    db
      .select({ pr: purchaseRequests, requesterName: users.fullName })
      .from(purchaseRequests)
      .innerJoin(users, eq(users.id, purchaseRequests.requesterId))
      .where(where)
      .orderBy(...orderBy(q.sort, q.order, SORTABLE, purchaseRequests.id))
      .limit(q.pageSize)
      .offset(pageOffset(q)),
    db.select({ total: count() }).from(purchaseRequests).where(where),
  ]);
  return paginated(rows, totals[0]?.total ?? 0, q);
}

/** Một phiếu trong phạm vi xem của người đó; ngoài phạm vi hoặc không tồn tại: null (nơi gọi trả 404). */
export async function findViewablePurchaseRequest(
  db: DbOrTx,
  actor: Viewer,
  id: string,
): Promise<PrWithRequester | null> {
  const [r] = await db
    .select({ pr: purchaseRequests, requesterName: users.fullName })
    .from(purchaseRequests)
    .innerJoin(users, eq(users.id, purchaseRequests.requesterId))
    .where(and(eq(purchaseRequests.id, id), isNull(purchaseRequests.deletedAt)))
    .limit(1);
  return r && canView(viewScope(actor), r.pr) ? r : null;
}
