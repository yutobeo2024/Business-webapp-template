import { Inject, Injectable } from "@nestjs/common";
import { count, eq, inArray, sql } from "drizzle-orm";
import { rolePermissions, roles, userRoles, type Db, type DbOrTx } from "@app/db";
import {
  CORE_PERMISSIONS,
  type CurrentUser,
  isPermission,
  type ListRolesQuery,
  type Paginated,
  type Permission,
  permissionGroups,
  type RoleDto,
  SYSTEM_ROLE_REQUIRED_PERMISSIONS,
  type createRoleSchema,
  type updateRoleSchema,
} from "@app/shared";
import type { z } from "zod";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { isUniqueViolation } from "../../common/db-errors.js";
import { orderBy, pageOffset, paginated, searchCondition } from "@app/server";
import { DB } from "../../db/db.module.js";
import { assertAdminRemains, assertNoEscalation, lockAdminInvariant } from "./safeguards.js";

type CreateRole = z.output<typeof createRoleSchema>;
type UpdateRole = z.output<typeof updateRoleSchema>;

const ENTITY = "role";
// Ghi rõ bảng cho từng cột trong truy vấn con (xem departments.service.ts).
const userCount = sql<number>`(select count(*)::int from ${userRoles} where ${userRoles}.${sql.identifier("role_id")} = ${roles}.${sql.identifier("id")})`;
const SORTABLE = { name: roles.name, createdAt: roles.createdAt } satisfies Record<
  ListRolesQuery["sort"],
  unknown
>;

const systemRoleError = (message: string) => new BusinessError("ROLE_SYSTEM", message, 422);

@Injectable()
export class RolesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  permissionCatalog() {
    return permissionGroups();
  }

  async list(q: ListRolesQuery): Promise<Paginated<RoleDto>> {
    const where = searchCondition(q.q, [roles.name, roles.description]);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isSystem: roles.isSystem,
          version: roles.version,
          userCount,
        })
        .from(roles)
        .where(where)
        .orderBy(...orderBy(q.sort, q.order, SORTABLE, roles.id))
        .limit(q.pageSize)
        .offset(pageOffset(q)),
      this.db.select({ total: count() }).from(roles).where(where),
    ]);
    const perms = await this.permissionsByRole(
      this.db,
      rows.map((r) => r.id),
    );
    return paginated(
      rows.map((r) => ({ ...r, permissions: perms.get(r.id) ?? [] })),
      totals[0]?.total ?? 0,
      q,
    );
  }

  async get(id: string, db: DbOrTx = this.db): Promise<RoleDto> {
    const [row] = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        version: roles.version,
        userCount,
      })
      .from(roles)
      .where(eq(roles.id, id));
    if (!row) throw Errors.notFound("ROLE");
    return { ...row, permissions: (await this.permissionsByRole(db, [id])).get(id) ?? [] };
  }

  async create(actor: CurrentUser, input: CreateRole, ip: string | null): Promise<RoleDto> {
    assertNoEscalation(actor, input.permissions);
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(roles)
          .values({ name: input.name, description: input.description })
          .returning();
        await this.setPermissions(tx, created!.id, input.permissions);
        await writeAudit(tx, {
          actorId: actor.id,
          action: "role.create",
          entityType: ENTITY,
          entityId: created!.id,
          after: { ...created, permissions: input.permissions },
          ip,
        });
        return this.get(created!.id, tx);
      });
    } catch (err) {
      throw this.nameTaken(err, input.name);
    }
  }

  async update(actor: CurrentUser, id: string, input: UpdateRole, ip: string | null): Promise<RoleDto> {
    try {
      return await this.db.transaction(async (tx) => {
        // Đổi quyền của vai trò có thể làm mất người quản trị cuối cùng: xếp hàng với các thao tác cùng loại.
        await lockAdminInvariant(tx);
        const [current] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
        if (!current) throw Errors.notFound("ROLE");
        if (current.version !== input.version) throw Errors.versionConflict();
        const before = (await this.permissionsByRole(tx, [id])).get(id) ?? [];
        // BR-A7: sửa quyền của vai trò mình đang giữ là tự cấp quyền cho mình (kể cả quyền nghiệp vụ).
        const permissionsChanged = before.join() !== input.permissions.join();
        if (permissionsChanged && actor.roles.some((r) => r.id === id)) {
          throw new BusinessError(
            "ROLE_SELF_EDIT",
            "Không sửa quyền của vai trò bạn đang giữ. Nhờ quản trị viên khác.",
            403,
          );
        }
        // Không sửa vai trò mang quyền quản trị mình chưa có, không đưa thêm quyền đó vào.
        assertNoEscalation(actor, [...before, ...input.permissions]);
        if (current.isSystem) {
          if (input.name !== current.name) throw systemRoleError("Không đổi tên vai trò hệ thống.");
          const missing = SYSTEM_ROLE_REQUIRED_PERMISSIONS.filter((p) => !input.permissions.includes(p));
          if (missing.length) {
            throw systemRoleError(`Vai trò hệ thống phải giữ quyền: ${missing.join(", ")}.`);
          }
          // BR-A6: tách biệt nhiệm vụ. Người quản trị cần quyền nghiệp vụ thì được gán thêm vai trò nghiệp vụ.
          const business = input.permissions.filter((p) => !Object.hasOwn(CORE_PERMISSIONS, p));
          if (business.length) {
            throw systemRoleError(
              `Vai trò hệ thống chỉ chứa quyền quản trị. Tạo vai trò nghiệp vụ riêng cho: ${business.join(", ")}.`,
            );
          }
        }
        const [updated] = await tx
          .update(roles)
          .set({ name: input.name, description: input.description, version: current.version + 1 })
          .where(eq(roles.id, id))
          .returning();
        await this.setPermissions(tx, id, input.permissions);
        await assertAdminRemains(tx);
        await writeAudit(tx, {
          actorId: actor.id,
          action: "role.update",
          entityType: ENTITY,
          entityId: id,
          before: { ...current, permissions: before },
          after: { ...updated, permissions: input.permissions },
          ip,
        });
        return this.get(id, tx);
      });
    } catch (err) {
      throw this.nameTaken(err, input.name);
    }
  }

  async remove(actor: CurrentUser, id: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Xếp hàng với thao tác gán vai trò (không để người khác vừa gán đúng vai trò đang bị xóa).
      await lockAdminInvariant(tx);
      const [current] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
      if (!current) throw Errors.notFound("ROLE");
      if (current.isSystem) throw systemRoleError("Không xóa vai trò hệ thống.");
      const permissions = (await this.permissionsByRole(tx, [id])).get(id) ?? [];
      assertNoEscalation(actor, permissions);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(userRoles)
        .where(eq(userRoles.roleId, id));
      if (n > 0) {
        throw new BusinessError(
          "ROLE_IN_USE",
          `Vai trò đang được gán cho ${n} người. Gỡ vai trò khỏi họ trước.`,
          409,
        );
      }
      await tx.delete(roles).where(eq(roles.id, id));
      await writeAudit(tx, {
        actorId: actor.id,
        action: "role.delete",
        entityType: ENTITY,
        entityId: id,
        before: { ...current, permissions },
        ip,
      });
    });
  }

  private async setPermissions(tx: DbOrTx, roleId: string, permissions: Permission[]): Promise<void> {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissions.length) {
      await tx.insert(rolePermissions).values(permissions.map((permission) => ({ roleId, permission })));
    }
  }

  /** Quyền theo vai trò; quyền không còn trong danh mục bị bỏ qua (giống lúc nạp quyền cho phiên). */
  private async permissionsByRole(db: DbOrTx, roleIds: string[]): Promise<Map<string, Permission[]>> {
    const map = new Map<string, Permission[]>();
    if (!roleIds.length) return map;
    const rows = await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
    for (const r of rows) {
      if (isPermission(r.permission)) map.set(r.roleId, [...(map.get(r.roleId) ?? []), r.permission]);
    }
    for (const list of map.values()) list.sort();
    return map;
  }

  private nameTaken(err: unknown, name: string): unknown {
    return isUniqueViolation(err)
      ? new BusinessError("ROLE_NAME_TAKEN", `Đã có vai trò tên "${name}"`, 409)
      : err;
  }
}
