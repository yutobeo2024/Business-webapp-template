/**
 * Seed dữ liệu ban đầu. Idempotent: chạy nhiều lần không tạo trùng.
 *   pnpm db:seed            -> vai trò mặc định, phòng ban mặc định, tài khoản quản trị từ SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   pnpm db:seed -- --demo  -> thêm tài khoản demo cho từng vai trò (CẤM ở production)
 *   pnpm db:seed -- --sync-default-roles -> thêm quyền mặc định MỚI (chưa từng đồng bộ) vào vai trò mặc định đã có (sau khi module mới
 *                             thêm quyền vào DEFAULT_ROLES); chỉ thêm, không gỡ quyền quản trị viên đã chỉnh
 */
import { eq, sql } from "drizzle-orm";
import { createDb, departments, userRoles, users } from "@app/db";
import { hashPassword } from "../auth/crypto.js";
import {
  type DefaultRoleKey,
  ensureDefaultRoles,
  syncDefaultRolePermissions,
} from "../auth/default-roles.js";

const url = process.env.DATABASE_URL;
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const isProd = process.env.NODE_ENV === "production";
const demo = process.argv.includes("--demo");
const syncRoles = process.argv.includes("--sync-default-roles");

function fail(msg: string): never {
  console.error(`[seed] ${msg}`);
  process.exit(1);
}

if (!url) fail("Thiếu DATABASE_URL");
if (!adminEmail || !adminPassword) fail("Thiếu SEED_ADMIN_EMAIL hoặc SEED_ADMIN_PASSWORD");
if (isProd && adminPassword.length < 14) fail("Production: SEED_ADMIN_PASSWORD phải tối thiểu 14 ký tự");
if (isProd && demo) fail("Không được tạo tài khoản demo trên production");

const { db, close } = createDb(url, { max: 1, appName: "seed" });

async function upsertDepartment(code: string, name: string): Promise<void> {
  await db.insert(departments).values({ code, name }).onConflictDoNothing({ target: departments.code });
}

async function departmentId(code: string | null): Promise<string | null> {
  if (!code) return null;
  const [d] = await db.select({ id: departments.id }).from(departments).where(eq(departments.code, code));
  if (!d) throw new Error(`Chưa có phòng ban ${code}`);
  return d.id;
}

let roleIds: Record<DefaultRoleKey, string>;

async function ensureUser(
  email: string,
  fullName: string,
  role: DefaultRoleKey,
  password: string,
  departmentCode: string | null,
) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  if (existing) return;
  const [created] = await db
    .insert(users)
    .values({
      email,
      fullName,
      departmentId: await departmentId(departmentCode),
      passwordHash: await hashPassword(password),
    })
    .returning({ id: users.id });
  await db.insert(userRoles).values({ userId: created!.id, roleId: roleIds[role] });
  console.warn(`[seed] Tạo ${role} ${email}`);
}

try {
  roleIds = await ensureDefaultRoles(db);
  if (syncRoles) {
    const changes = await syncDefaultRolePermissions(db);
    for (const c of changes) console.warn(`[seed] Vai trò "${c.role}": thêm ${c.added.join(", ")}`);
    if (changes.length === 0) console.warn("[seed] Vai trò mặc định đã đủ quyền");
  }
  await upsertDepartment("KD", "Phòng Kinh doanh");
  await upsertDepartment("KT", "Phòng Kế toán");
  await ensureUser(adminEmail, "Quản trị hệ thống", "ADMIN", adminPassword, null);
  if (demo) {
    // Tài khoản demo theo vai trò mặc định (mật khẩu = SEED_ADMIN_PASSWORD): module thêm tài khoản của mình ở đây,
    // đồng bộ với e2e/users.ts.
    // sample:begin
    await ensureUser("nhanvien@example.com", "Nguyễn Văn Nhân", "STAFF", adminPassword, "KD");
    await ensureUser("truongphong@example.com", "Trần Thị Trưởng", "MANAGER", adminPassword, "KD");
    await ensureUser("giamdoc@example.com", "Lê Văn Giám", "DIRECTOR", adminPassword, null);
    await ensureUser("ketoan@example.com", "Phạm Thị Toán", "ACCOUNTANT", adminPassword, "KT");
    await ensureUser("truongphong.kt@example.com", "Hoàng Thị Kế", "MANAGER", adminPassword, "KT");
    // sample:end
  }
  console.warn("[seed] Xong");
} finally {
  await close();
}
