/**
 * Truy vấn ĐỌC danh sách người dùng, dùng chung cho màn quản trị (api) và xuất Excel danh sách người dùng (worker): cùng
 * bộ lọc, cùng thứ tự. Quyền xem do nơi gọi kiểm (`users.manage`).
 */
import { and, count, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { departments, roles, userRoles, users, type DbOrTx } from "@app/db";
import type { ListUsersQuery, Paginated } from "@app/shared";
import { orderBy, pageOffset, paginated, searchCondition } from "../list-query.js";

export type UserRow = typeof users.$inferSelect;
export interface UserListItem {
  user: UserRow;
  departmentName: string | null;
  roles: { id: string; name: string }[];
}

const SORTABLE = {
  fullName: users.fullName,
  email: users.email,
  createdAt: users.createdAt,
} satisfies Record<ListUsersQuery["sort"], unknown>;

/** Vai trò của từng người, sắp theo tên. */
export async function rolesByUser(db: DbOrTx, userIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (!userIds.length) return map;
  const rows = await db
    .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds))
    .orderBy(roles.name);
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

export async function listUsers(
  db: DbOrTx,
  q: ListUsersQuery,
  now = new Date(),
): Promise<Paginated<UserListItem>> {
  const where = and(
    searchCondition(q.q, [users.fullName, users.email]),
    q.departmentId ? eq(users.departmentId, q.departmentId) : undefined,
    q.roleId
      ? inArray(
          users.id,
          db.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, q.roleId)),
        )
      : undefined,
    q.status === "inactive" ? eq(users.isActive, false) : undefined,
    q.status === "locked" ? gt(users.lockedUntil, now) : undefined,
    q.status === "active"
      ? and(eq(users.isActive, true), or(isNull(users.lockedUntil), lte(users.lockedUntil, now)))
      : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select({ user: users, departmentName: departments.name })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(where)
      .orderBy(...orderBy(q.sort, q.order, SORTABLE, users.id))
      .limit(q.pageSize)
      .offset(pageOffset(q)),
    db.select({ total: count() }).from(users).where(where),
  ]);
  const roleMap = await rolesByUser(
    db,
    rows.map((r) => r.user.id),
  );
  return paginated(
    rows.map((r) => ({ ...r, roles: roleMap.get(r.user.id) ?? [] })),
    totals[0]?.total ?? 0,
    q,
  );
}
