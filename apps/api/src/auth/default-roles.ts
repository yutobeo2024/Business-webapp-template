import { and, eq, isNull, sql } from "drizzle-orm";
import { rolePermissions, roles, type DbOrTx } from "@app/db";
import { writeAudit } from "@app/server";
import { type Permission, SYSTEM_ROLE_REQUIRED_PERMISSIONS } from "@app/shared";

/**
 * Vai trò mặc định tạo bởi seed. Sau đó quản trị viên tự sửa trên giao diện; seed chạy lại KHÔNG ghi đè vai trò đã có
 * (chỉ tạo vai trò còn thiếu). Đổi DEFAULT_ROLES (thêm quyền cho module mới) thì chạy
 * `pnpm db:seed -- --sync-default-roles` để thêm quyền còn thiếu vào vai trò mặc định trên DB đã seed.
 */
export const DEFAULT_ROLES = {
  ADMIN: {
    name: "Quản trị hệ thống",
    description: "Quản lý tài khoản, vai trò, phòng ban. Không tham gia nghiệp vụ (tách biệt nhiệm vụ).",
    isSystem: true,
    permissions: [...SYSTEM_ROLE_REQUIRED_PERMISSIONS, "departments.manage"],
  },
  // sample:begin (vai trò nghiệp vụ của module mẫu; module thật thêm vai trò của mình ở đây)
  STAFF: { name: "Nhân viên", description: "Lập phiếu, xem phiếu của mình.", permissions: ["pr.create"] },
  MANAGER: {
    name: "Trưởng phòng",
    description: "Lập phiếu, xem, duyệt và xuất Excel phiếu của phòng ban mình.",
    permissions: ["pr.create", "pr.view.department", "pr.approve.department", "pr.export"],
  },
  ACCOUNTANT: {
    name: "Kế toán",
    description: "Lập phiếu, xem và xuất Excel mọi phiếu.",
    permissions: ["pr.create", "pr.view.all", "pr.export"],
  },
  DIRECTOR: {
    name: "Giám đốc",
    description: "Xem và xuất Excel mọi phiếu, duyệt cấp cuối.",
    permissions: ["pr.view.all", "pr.approve.final", "pr.export"],
  },
  // sample:end
} as const satisfies Record<
  string,
  { name: string; description: string; isSystem?: boolean; permissions: readonly Permission[] }
>;
export type DefaultRoleKey = keyof typeof DEFAULT_ROLES;

type RoleDef = (typeof DEFAULT_ROLES)[DefaultRoleKey];

/**
 * Tạo vai trò mặc định còn thiếu. Trả id theo khóa. Idempotent.
 * Vai trò nhận diện bằng `default_key` (quản trị đổi tên được). Vai trò cùng tên có từ trước khi có cột này (dự án tạo
 * từ kit < 1.4.0) được NHẬN VÀO với mốc đồng bộ = danh sách quyền mặc định hiện tại: không cấp quyền nào lúc nhận, vì
 * không biết quản trị viên đã gỡ quyền nào; quyền thêm vào DEFAULT_ROLES SAU đó mới được đồng bộ.
 */
export async function ensureDefaultRoles(db: DbOrTx): Promise<Record<DefaultRoleKey, string>> {
  const ids = {} as Record<DefaultRoleKey, string>;
  for (const [key, def] of Object.entries(DEFAULT_ROLES) as [DefaultRoleKey, RoleDef][]) {
    const [byKey] = await db.select({ id: roles.id }).from(roles).where(eq(roles.defaultKey, key));
    if (byKey) {
      ids[key] = byKey.id;
      continue;
    }
    const [legacy] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(sql`lower(${roles.name}) = lower(${def.name})`, isNull(roles.defaultKey)));
    if (legacy) {
      await db
        .update(roles)
        .set({ defaultKey: key, syncedDefaultPermissions: [...def.permissions] })
        .where(eq(roles.id, legacy.id));
      ids[key] = legacy.id;
      continue;
    }
    const [created] = await db
      .insert(roles)
      .values({
        name: def.name,
        description: def.description,
        isSystem: "isSystem" in def && def.isSystem,
        defaultKey: key,
        syncedDefaultPermissions: [...def.permissions],
      })
      .returning({ id: roles.id });
    if (!created) throw new Error(`Không tạo được vai trò ${def.name}`);
    await db
      .insert(rolePermissions)
      .values(def.permissions.map((permission) => ({ roleId: created.id, permission })));
    ids[key] = created.id;
  }
  // Chỉ một vai trò hệ thống.
  const systemRoles = await db.select({ id: roles.id }).from(roles).where(eq(roles.isSystem, true));
  if (systemRoles.length !== 1)
    throw new Error(`Phải có đúng 1 vai trò hệ thống, đang có ${systemRoles.length}`);
  return ids;
}

/**
 * Thêm vào vai trò mặc định ĐÃ CÓ các quyền mới được thêm vào DEFAULT_ROLES kể từ lần seed/đồng bộ trước (module mới
 * sau khi DB đã seed). Chỉ thêm quyền chưa từng đồng bộ: quyền quản trị viên đã gỡ khỏi vai trò KHÔNG bị cấp lại, quyền
 * quản trị tự thêm được giữ. Vai trò nhận diện bằng `default_key`, không theo tên. Mỗi vai trò được thêm quyền thì tăng
 * version và ghi audit `role.sync_defaults`.
 */
export async function syncDefaultRolePermissions(
  db: DbOrTx,
): Promise<{ role: string; added: Permission[] }[]> {
  const changes: { role: string; added: Permission[] }[] = [];
  for (const [key, def] of Object.entries(DEFAULT_ROLES) as [DefaultRoleKey, RoleDef][]) {
    const [role] = await db
      .select({ id: roles.id, name: roles.name, synced: roles.syncedDefaultPermissions })
      .from(roles)
      .where(eq(roles.defaultKey, key))
      .for("update");
    if (!role) continue; // chưa có thì ensureDefaultRoles tạo
    const pending = def.permissions.filter((p) => !role.synced.includes(p));
    if (pending.length === 0) continue;
    const added = await db
      .insert(rolePermissions)
      .values(pending.map((permission) => ({ roleId: role.id, permission })))
      .onConflictDoNothing()
      .returning({ permission: rolePermissions.permission });
    await db
      .update(roles)
      .set({
        syncedDefaultPermissions: [...new Set([...role.synced, ...def.permissions])],
        ...(added.length ? { version: sql`${roles.version} + 1` } : {}),
      })
      .where(eq(roles.id, role.id));
    if (added.length === 0) continue;
    const list = added.map((a) => a.permission as Permission).sort();
    await writeAudit(db, {
      actorId: null,
      action: "role.sync_defaults",
      entityType: "role",
      entityId: role.id,
      after: { added: list },
    });
    changes.push({ role: role.name, added: list });
  }
  return changes;
}
