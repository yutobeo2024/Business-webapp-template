import { eq, sql } from "drizzle-orm";
import { roles, userRoles, users, type DbOrTx } from "@app/db";
import { writeAudit } from "../common/audit.js";

/**
 * Khôi phục quyền quản trị cho một tài khoản (spec 000 BR-A5): kích hoạt lại, gán vai trò hệ thống, gỡ tạm khóa do đăng
 * nhập sai. Chỉ chạy từ máy chủ bằng `node dist/cli/grant-admin.js <email>` (runbook incident), không có endpoint HTTP.
 */
export async function grantAdmin(db: DbOrTx, email: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .for("update");
    if (!user)
      throw new Error(`Không có tài khoản ${email}. Tạo bằng pnpm db:seed (SEED_ADMIN_EMAIL) rồi chạy lại.`);
    const [system] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.isSystem, true));
    if (!system) throw new Error("Chưa có vai trò hệ thống. Chạy pnpm db:seed trước.");
    await tx
      .update(users)
      .set({ isActive: true, failedLoginCount: 0, lockedUntil: null, version: sql`${users.version} + 1` })
      .where(eq(users.id, user.id));
    await tx.insert(userRoles).values({ userId: user.id, roleId: system.id }).onConflictDoNothing();
    await writeAudit(tx, {
      actorId: null,
      action: "user.grant_admin",
      entityType: "user",
      entityId: user.id,
      ip: null,
    });
  });
}
