import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb, departments, rolePermissions, roles, userRoles, users, type DbHandle } from "@app/db";
import type { CurrentUser, Permission } from "@app/shared";
import { loadAccess } from "../src/auth/access.js";
import { hashPassword } from "../src/auth/crypto.js";
import { ensureDefaultRoles } from "../src/auth/default-roles.js";
import type { Env } from "../src/config/env.js";

export const TEST_PASSWORD = "mat-khau-test-123";
export const TEST_ORIGIN = "http://app.test";
/** Thư mục tệp riêng cho test (tạm, mỗi lần chạy một thư mục). */
export const TEST_STORAGE_DIR = mkdtempSync(join(tmpdir(), "app-test-files-"));

let ipCounter = 0;
/** IP giả khác nhau cho mỗi lần gọi, đi qua X-Forwarded-For (app tin 1 proxy như sau Caddy). */
export const nextIp = (): string => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

export function testEnv(): Env {
  return {
    NODE_ENV: "test",
    PORT: 0,
    APP_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: process.env.DATABASE_URL!,
    REDIS_URL: process.env.REDIS_URL!,
    SESSION_TTL_HOURS: 12,
    SESSION_MAX_DAYS: 7,
    LOG_LEVEL: "error",
    TRUST_PROXY_HOPS: 1,
    DB_POOL_MAX: 5,
    STORAGE_DRIVER: "local",
    STORAGE_DIR: TEST_STORAGE_DIR,
    FILE_MAX_MB: 1,
    SMTP_URL: "smtp://localhost:1025",
    ZALO_ENABLED: false,
  };
}

export const openDb = (): DbHandle => createDb(process.env.DATABASE_URL!, { max: 5, appName: "test" });

/** Xóa sạch MỌI bảng nghiệp vụ (cả bảng module thêm sau), giữ lịch sử migration. */
export async function resetDb(handle: DbHandle): Promise<void> {
  const res = await handle.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = res.rows.map((r) => sql.identifier(r.tablename));
  if (tables.length) {
    await handle.db.execute(sql`truncate table ${sql.join(tables, sql`, `)} restart identity cascade`);
  }
}

/** Người dùng có một vai trò riêng mang đúng các quyền cho trước (quyền phải có trong danh mục). */
export async function makeUser(
  handle: DbHandle,
  opts: { email: string; fullName: string; permissions: Permission[]; departmentId?: string | null },
): Promise<CurrentUser & { roleId: string }> {
  const { db } = handle;
  const [role] = await db
    .insert(roles)
    .values({ name: `Vai trò test ${opts.email}` })
    .returning();
  if (opts.permissions.length) {
    await db
      .insert(rolePermissions)
      .values(opts.permissions.map((permission) => ({ roleId: role!.id, permission })));
  }
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email,
      fullName: opts.fullName,
      departmentId: opts.departmentId ?? null,
      passwordHash: await hashPassword(TEST_PASSWORD),
    })
    .returning();
  await db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
  return {
    id: u!.id,
    email: u!.email,
    fullName: u!.fullName,
    departmentId: u!.departmentId,
    mustChangePassword: false,
    roleId: role!.id,
    ...(await loadAccess(db, u!.id)),
  };
}

/** Vai trò dùng chung, gán sẵn cho nhiều người (để test lọc/đếm theo vai trò). */
async function sharedRole(handle: DbHandle, name: string, permissions: Permission[]): Promise<string> {
  const [role] = await handle.db.insert(roles).values({ name }).returning();
  if (permissions.length) {
    await handle.db
      .insert(rolePermissions)
      .values(permissions.map((permission) => ({ roleId: role!.id, permission })));
  }
  return role!.id;
}

async function withRole(handle: DbHandle, user: CurrentUser & { roleId: string }, roleId: string) {
  await handle.db.delete(userRoles).where(eq(userRoles.userId, user.id));
  await handle.db.insert(userRoles).values({ userId: user.id, roleId });
  return { ...user, roleId, ...(await loadAccess(handle.db, user.id)) };
}

/**
 * Dữ liệu chung cho test LÕI: chỉ dùng quyền lõi, không phụ thuộc module mẫu (test vẫn chạy sau `pnpm sample:remove`).
 * Module nghiệp vụ có fixture riêng (mẫu: test/sample/fixture.ts).
 */
export interface Fixture {
  deptKd: string;
  deptKt: string;
  /** Vai trò "Quản trị hệ thống" (users/roles/departments.manage). */
  admin: CurrentUser;
  /** Vai trò "Nhân viên": không có quyền nào ngoài đăng nhập. */
  staff: CurrentUser & { roleId: string };
  staff2: CurrentUser & { roleId: string };
  /** Vai trò "Phụ trách phòng ban": chỉ departments.manage (một quyền lõi không phải quản trị người dùng). */
  deptManager: CurrentUser & { roleId: string };
  roleIds: { ADMIN: string; STAFF: string; DEPT: string };
}

export async function seedFixture(handle: DbHandle): Promise<Fixture> {
  const { db } = handle;
  const [kd] = await db.insert(departments).values({ code: "KD", name: "Kinh doanh" }).returning();
  const [kt] = await db.insert(departments).values({ code: "KT", name: "Kế toán" }).returning();
  const defaults = await ensureDefaultRoles(db);
  const STAFF = await sharedRole(handle, "Nhân viên (test)", []);
  const DEPT = await sharedRole(handle, "Phụ trách phòng ban", ["departments.manage"]);
  const mk = (email: string, fullName: string, departmentId: string | null) =>
    makeUser(handle, { email, fullName, permissions: [], departmentId });
  return {
    deptKd: kd!.id,
    deptKt: kt!.id,
    admin: await withRole(handle, await mk("admin@test.vn", "Quản trị", null), defaults.ADMIN),
    staff: await withRole(handle, await mk("staff@test.vn", "Nhân viên A", kd!.id), STAFF),
    staff2: await withRole(handle, await mk("staff2@test.vn", "Nhân viên B", kd!.id), STAFF),
    deptManager: await withRole(handle, await mk("phongban@test.vn", "Phụ trách phòng ban", kt!.id), DEPT),
    roleIds: { ADMIN: defaults.ADMIN, STAFF, DEPT },
  };
}
