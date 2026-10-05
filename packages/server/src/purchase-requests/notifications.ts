/**
 * Ai được báo khi phiếu đổi trạng thái (spec 001 mục 7). Người nhận tính theo quyền HIỆN TẠI và phải xem được phiếu;
 * tài khoản bị khóa không nhận.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { purchaseRequests, rolePermissions, userRoles, users, type DbOrTx } from "@app/db";
import type { NotificationData, NotificationType, Permission, PrStatus } from "@app/shared";
import { loadAccess } from "../access.js";
import { canView, viewScope } from "./policy.js";

type PrRow = typeof purchaseRequests.$inferSelect;

export interface PlannedNotification<T extends NotificationType = NotificationType> {
  type: T;
  userIds: string[];
  data: NotificationData<T>;
}

/** Người đang hoạt động có quyền `permission` (qua bất kỳ vai trò nào), tùy chọn giới hạn phòng ban. */
async function activeHolders(db: DbOrTx, permission: Permission, departmentId?: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(
      and(
        eq(rolePermissions.permission, permission),
        eq(users.isActive, true),
        departmentId ? eq(users.departmentId, departmentId) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

/** Chỉ giữ người xem được phiếu (có quyền duyệt mà không có quyền xem thì không nhận nội dung phiếu). */
async function canSee(db: DbOrTx, userIds: string[], pr: PrRow): Promise<string[]> {
  const out: string[] = [];
  for (const id of userIds) {
    const [u] = await db
      .select({ departmentId: users.departmentId, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, id));
    if (!u?.isActive) continue;
    const { permissions } = await loadAccess(db, id);
    if (canView(viewScope({ id, departmentId: u.departmentId, permissions }), pr)) out.push(id);
  }
  return out;
}

export async function planPrStatusNotification(
  db: DbOrTx,
  prId: string,
  to: PrStatus,
): Promise<PlannedNotification | null> {
  const [r] = await db
    .select({ pr: purchaseRequests, requesterName: users.fullName })
    .from(purchaseRequests)
    .innerJoin(users, eq(users.id, purchaseRequests.requesterId))
    .where(
      and(
        eq(purchaseRequests.id, prId),
        isNull(purchaseRequests.deletedAt),
        ne(purchaseRequests.status, "DRAFT"),
      ),
    );
  // Phiếu đã đổi tiếp sang trạng thái khác (job đến muộn): không báo trạng thái cũ.
  if (!r || r.pr.status !== to) return null;
  const { pr } = r;
  const ref = {
    prId: pr.id,
    code: pr.code,
    title: pr.title,
    totalAmount: pr.totalAmount,
    requesterName: r.requesterName,
  };
  const others = (ids: string[]) => ids.filter((id) => id !== pr.requesterId);

  switch (to) {
    case "PENDING_MANAGER":
      return {
        type: "pr.pending_approval",
        userIds: await canSee(
          db,
          others(await activeHolders(db, "pr.approve.department", pr.departmentId)),
          pr,
        ),
        data: ref,
      };
    case "PENDING_DIRECTOR":
      return {
        type: "pr.pending_approval",
        userIds: await canSee(db, others(await activeHolders(db, "pr.approve.final")), pr),
        data: ref,
      };
    case "APPROVED":
      return { type: "pr.approved", userIds: await canSee(db, [pr.requesterId], pr), data: ref };
    case "REJECTED":
      return {
        type: "pr.rejected",
        userIds: await canSee(db, [pr.requesterId], pr),
        data: { ...ref, reason: pr.rejectReason ?? "" },
      };
    default:
      return null;
  }
}
