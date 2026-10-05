/**
 * Fixture của module MẪU phiếu đề nghị (cả thư mục test/sample bị xóa bởi `pnpm sample:remove`). Người dùng mang vai trò
 * mặc định của mẫu (Nhân viên, Trưởng phòng, Kế toán, Giám đốc). Module thật viết fixture riêng theo cách này.
 */
import { departments, userRoles, users, type DbHandle } from "@app/db";
import type { CurrentUser } from "@app/shared";
import { loadAccess } from "../../src/auth/access.js";
import { hashPassword } from "../../src/auth/crypto.js";
import { type DefaultRoleKey, ensureDefaultRoles } from "../../src/auth/default-roles.js";
import { TEST_PASSWORD } from "../helpers.js";

export interface SampleFixture {
  deptKd: string;
  deptKt: string;
  staff: CurrentUser;
  staff2: CurrentUser;
  manager: CurrentUser;
  managerKt: CurrentUser;
  director: CurrentUser;
  accountant: CurrentUser;
  admin: CurrentUser;
  roleIds: Record<DefaultRoleKey, string>;
}

export async function seedSampleFixture(handle: DbHandle): Promise<SampleFixture> {
  const { db } = handle;
  const [kd] = await db.insert(departments).values({ code: "KD", name: "Kinh doanh" }).returning();
  const [kt] = await db.insert(departments).values({ code: "KT", name: "Kế toán" }).returning();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const roleIds = await ensureDefaultRoles(db);
  const mk = async (
    email: string,
    fullName: string,
    role: DefaultRoleKey,
    departmentId: string | null,
  ): Promise<CurrentUser> => {
    const [u] = await db.insert(users).values({ email, fullName, departmentId, passwordHash }).returning();
    await db.insert(userRoles).values({ userId: u!.id, roleId: roleIds[role] });
    return {
      id: u!.id,
      email: u!.email,
      fullName: u!.fullName,
      departmentId: u!.departmentId,
      mustChangePassword: false,
      ...(await loadAccess(db, u!.id)),
    };
  };
  return {
    deptKd: kd!.id,
    deptKt: kt!.id,
    staff: await mk("staff@test.vn", "Nhân viên A", "STAFF", kd!.id),
    staff2: await mk("staff2@test.vn", "Nhân viên B", "STAFF", kd!.id),
    manager: await mk("manager@test.vn", "Trưởng phòng KD", "MANAGER", kd!.id),
    managerKt: await mk("manager-kt@test.vn", "Trưởng phòng KT", "MANAGER", kt!.id),
    director: await mk("director@test.vn", "Giám đốc", "DIRECTOR", null),
    accountant: await mk("accountant@test.vn", "Kế toán", "ACCOUNTANT", kt!.id),
    admin: await mk("admin@test.vn", "Quản trị", "ADMIN", null),
    roleIds,
  };
}
