/**
 * Dữ liệu cho test tích hợp LÕI của worker (DB thật): chỉ dùng bảng và quyền lõi, chạy được sau `pnpm sample:remove`.
 * Không build vào dist (tsconfig.build loại thư mục testing). Module nghiệp vụ có fixture riêng (mẫu: src/sample/fixture.ts).
 */
import { sql } from "drizzle-orm";
import { departments, rolePermissions, roles, userRoles, users, type Db } from "@app/db";
import type { Permission } from "@app/shared";

/** Xóa sạch MỌI bảng (cả bảng module thêm sau, giữ lịch sử migration), tạo hai phòng ban KD, KT. */
export async function resetWorkerDb(db: Db): Promise<{ deptKd: string; deptKt: string }> {
  const res = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = res.rows.map((r) => sql.identifier(r.tablename));
  if (tables.length)
    await db.execute(sql`truncate table ${sql.join(tables, sql`, `)} restart identity cascade`);
  const [kd] = await db.insert(departments).values({ code: "KD", name: "Kinh doanh" }).returning();
  const [kt] = await db.insert(departments).values({ code: "KT", name: "Kế toán" }).returning();
  return { deptKd: kd!.id, deptKt: kt!.id };
}

/** Người dùng có một vai trò riêng mang đúng các quyền cho trước. */
export async function makeUser(
  db: Db,
  name: string,
  departmentId: string | null,
  permissions: Permission[],
): Promise<{ id: string; roleId: string }> {
  const [role] = await db
    .insert(roles)
    .values({ name: `Vai trò ${name}` })
    .returning();
  if (permissions.length) {
    await db.insert(rolePermissions).values(permissions.map((p) => ({ roleId: role!.id, permission: p })));
  }
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@test.vn`, fullName: name, departmentId, passwordHash: "x" })
    .returning();
  await db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
  return { id: u!.id, roleId: role!.id };
}
