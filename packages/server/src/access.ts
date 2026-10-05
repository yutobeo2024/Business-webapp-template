import { eq } from "drizzle-orm";
import { rolePermissions, roles, userRoles, type DbOrTx } from "@app/db";
import { isPermission, type Permission } from "@app/shared";

export interface Access {
  roles: { id: string; name: string }[];
  permissions: Permission[];
}

/**
 * Vai trò và quyền hiện tại của một người dùng. API đọc mỗi request (đổi vai trò có hiệu lực ngay); worker đọc lại lúc chạy
 * job (người bị thu quyền giữa chừng không nhận được dữ liệu). Quyền không còn trong danh mục bị bỏ qua.
 */
export async function loadAccess(db: DbOrTx, userId: string): Promise<Access> {
  const rows = await db
    .select({ roleId: roles.id, roleName: roles.name, permission: rolePermissions.permission })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const roleMap = new Map<string, string>();
  const permissions = new Set<Permission>();
  for (const r of rows) {
    roleMap.set(r.roleId, r.roleName);
    if (r.permission && isPermission(r.permission)) permissions.add(r.permission);
  }
  return {
    roles: [...roleMap]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    permissions: [...permissions].sort(),
  };
}
