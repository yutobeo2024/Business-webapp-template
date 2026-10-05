/**
 * Chốt chặn của màn quản trị (spec 000, ADR-0004). Mọi thao tác ghi trong modules/admin gọi các hàm này TRONG
 * transaction của thao tác đó.
 */
import { and, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { rolePermissions, roles, userRoles, users, type DbOrTx } from "@app/db";
import { type CurrentUser, holderOnlyBeyond, PERMISSIONS } from "@app/shared";
import { BusinessError } from "../../common/business-error.js";

/**
 * Xếp hàng các thao tác có thể làm mất người quản trị cuối cùng (khóa người dùng, đổi vai trò, đổi quyền của vai trò).
 * Thiếu khóa này, hai quản trị viên khóa lẫn nhau cùng lúc: mỗi transaction thấy người kia còn hoạt động, cả hai commit,
 * hệ thống không còn ai quản trị.
 */
export async function lockAdminInvariant(tx: DbOrTx): Promise<void> {
  await tx.select({ id: roles.id }).from(roles).where(eq(roles.isSystem, true)).for("update");
}

/**
 * Sau thao tác, phải còn ít nhất một người ĐANG HOẠT ĐỘNG có CẢ users.manage và roles.manage (BR-A5): chỉ còn một trong
 * hai thì không ai cấp lại được quyền kia (quyền quản trị chỉ người đang có mới cấp được), hệ thống kẹt. Không còn: rollback.
 */
export async function assertAdminRemains(tx: DbOrTx): Promise<void> {
  const [row] = await tx
    .select({ n: countDistinct(users.id) })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(
      rolePermissions,
      and(
        eq(rolePermissions.roleId, userRoles.roleId),
        inArray(rolePermissions.permission, ["users.manage", "roles.manage"]),
      ),
    )
    .where(eq(users.isActive, true))
    .groupBy(users.id)
    .having(sql`count(distinct ${rolePermissions.permission}) = 2`)
    .limit(1);
  if (!row) {
    throw new BusinessError(
      "LAST_ADMIN",
      "Thao tác này làm hệ thống không còn ai đủ quyền quản trị (người dùng và vai trò). Hãy cấp quyền cho người khác trước.",
      409,
    );
  }
}

/**
 * Chống leo thang: không cấp (qua vai trò) và không thao tác trên tài khoản/vai trò mang quyền quản trị mà mình chưa có.
 * Quyền nghiệp vụ không bị chặn ở đây: người quản lý tài khoản gán được dù bản thân không có (tách biệt nhiệm vụ).
 */
export function assertNoEscalation(actor: CurrentUser, permissions: Iterable<string>): void {
  const beyond = holderOnlyBeyond(actor.permissions, permissions);
  if (beyond.length) {
    throw new BusinessError(
      "PERMISSION_ESCALATION",
      `Bạn không thể cấp hoặc thao tác với quyền quản trị mình chưa có: ${beyond
        .map((p) => PERMISSIONS[p].label)
        .join("; ")}`,
      403,
    );
  }
}

/** Không tự khóa mình, không tự đổi vai trò, không tự đặt lại mật khẩu (dùng đổi mật khẩu). */
export function assertNotSelf(actor: CurrentUser, targetUserId: string, action: string): void {
  if (actor.id === targetUserId) {
    throw new BusinessError(
      "USER_SELF_ACTION",
      `Không thể tự ${action} cho chính mình. Nhờ quản trị viên khác.`,
      403,
    );
  }
}

export async function permissionsOfRoles(tx: DbOrTx, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows = await tx
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  return [...new Set(rows.map((r) => r.permission))];
}

export async function roleIdsOfUser(tx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleId);
}
