import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, rolePermissions, userRoles, users, type DbHandle } from "@app/db";
import { grantAdmin } from "../src/auth/grant-admin.js";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { CORE_PERMISSIONS, type Permission, PERMISSIONS, QUEUES } from "@app/shared";
import { createApp } from "../src/bootstrap.js";
import { assertAdminRemains } from "../src/modules/admin/safeguards.js";
import {
  nextIp,
  openDb,
  resetDb,
  seedFixture,
  TEST_ORIGIN,
  TEST_PASSWORD,
  testEnv,
  type Fixture,
} from "./helpers.js";

let app: INestApplication;
let handle: DbHandle;
let f: Fixture;

beforeAll(async () => {
  handle = openDb();
  app = await createApp(testEnv(), { logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
  await handle.close();
});
beforeEach(async () => {
  await resetDb(handle);
  f = await seedFixture(handle);
});

type Agent = ReturnType<typeof request.agent>;
async function login(email: string, password = TEST_PASSWORD): Promise<Agent> {
  const a = request.agent(app.getHttpServer());
  const res = await a
    .post("/api/auth/login")
    .set("Origin", TEST_ORIGIN)
    .set("X-Forwarded-For", nextIp())
    .send({ email, password });
  expect(res.status, `đăng nhập ${email}`).toBe(200);
  return a;
}
const post = (a: Agent, url: string, body: object) =>
  a.post(url).set("Origin", TEST_ORIGIN).set("X-Forwarded-For", nextIp()).send(body);
const patch = (a: Agent, url: string, body: object) =>
  a.patch(url).set("Origin", TEST_ORIGIN).set("X-Forwarded-For", nextIp()).send(body);
const del = (a: Agent, url: string) =>
  a.delete(url).set("Origin", TEST_ORIGIN).set("X-Forwarded-For", nextIp());

const TEMP = "mat-khau-tam-2026";
/**
 * Một quyền NGHIỆP VỤ bất kỳ trong danh mục (của module đang có). Dự án vừa gỡ module mẫu, chưa có module nào: không có
 * quyền nghiệp vụ, các ca cần nó không áp dụng.
 */
const BUSINESS = (Object.keys(PERMISSIONS) as Permission[]).find((p) => !Object.hasOwn(CORE_PERMISSIONS, p));
const newUser = (over: object = {}) => ({
  email: "nguoi.moi@test.vn",
  fullName: "Người Mới",
  departmentId: f.deptKd,
  roleIds: [f.roleIds.STAFF],
  temporaryPassword: TEMP,
  ...over,
});
async function versionOf(id: string) {
  const [u] = await handle.db.select({ version: users.version }).from(users).where(eq(users.id, id));
  return u!.version;
}

describe("Quyền vào màn quản trị", () => {
  it("không có quyền quản trị: mọi endpoint admin trả 403", async () => {
    const a = await login(f.deptManager.email);
    for (const url of ["/api/admin/users", "/api/admin/roles", "/api/admin/permissions"]) {
      expect((await a.get(url)).status, url).toBe(403);
    }
    expect((await post(a, "/api/admin/users", newUser())).status).toBe(403);
  });
});

describe("Người dùng", () => {
  it("tạo tài khoản với mật khẩu tạm: người đó đăng nhập phải đổi mật khẩu; audit không có mã băm", async () => {
    const admin = await login(f.admin.email);
    const res = await post(admin, "/api/admin/users", newUser({ email: "Nguoi.Moi@Test.vn" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "nguoi.moi@test.vn", mustChangePassword: true, isActive: true });
    expect(res.body.roles.map((r: { name: string }) => r.name)).toEqual(["Nhân viên (test)"]);

    const me = (await (await login("nguoi.moi@test.vn", TEMP)).get("/api/auth/me")).body;
    expect(me.mustChangePassword).toBe(true);

    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, res.body.id));
    expect(audits.map((a) => a.action)).toContain("user.create");
    expect(JSON.stringify(audits)).not.toMatch(/argon2|passwordHash|password_hash/);
  });

  it("email trùng (không phân biệt hoa thường): 409", async () => {
    const admin = await login(f.admin.email);
    const res = await post(admin, "/api/admin/users", newUser({ email: f.staff.email.toUpperCase() }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("USER_EMAIL_TAKEN");
  });

  it("danh sách: tìm theo tên/email, lọc vai trò và trạng thái, cột sắp xếp lạ trả 400", async () => {
    const admin = await login(f.admin.email);
    const list = async (qs: string) => (await admin.get(`/api/admin/users?${qs}`)).body;
    expect((await list("q=phongban")).items.map((u: { email: string }) => u.email)).toEqual([
      f.deptManager.email,
    ]);
    expect((await list(`roleId=${f.roleIds.STAFF}`)).total).toBe(2);
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, f.staff2.id));
    expect((await list("status=inactive")).items.map((u: { id: string }) => u.id)).toEqual([f.staff2.id]);
    expect((await admin.get("/api/admin/users?sort=passwordHash")).status).toBe(400);
  });

  it("sửa với phiên bản cũ: 409, không ghi đè thay đổi của người khác", async () => {
    const admin = await login(f.admin.email);
    const body = { fullName: "Tên Mới", departmentId: f.deptKd, roleIds: [f.roleIds.STAFF], version: 1 };
    expect((await patch(admin, `/api/admin/users/${f.staff.id}`, body)).status).toBe(200);
    const stale = await patch(admin, `/api/admin/users/${f.staff.id}`, { ...body, fullName: "Ghi Đè" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
  });

  it("khóa tài khoản: phiên đang mở bị thu hồi ngay, không đăng nhập được; mở khóa thì đăng nhập lại được", async () => {
    const admin = await login(f.admin.email);
    const victim = await login(f.staff.email);
    const off = await post(admin, `/api/admin/users/${f.staff.id}/active`, { isActive: false, version: 1 });
    expect(off.status).toBe(200);
    expect((await victim.get("/api/auth/me")).status).toBe(401);
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    await post(admin, `/api/admin/users/${f.staff.id}/active`, { isActive: true, version: off.body.version });
    await login(f.staff.email);
  });

  it("đặt lại mật khẩu: thu hồi phiên, bắt đổi ở lần đăng nhập sau, gỡ khóa đăng nhập sai", async () => {
    const admin = await login(f.admin.email);
    const old = await login(f.staff.email);
    await handle.db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(users.id, f.staff.id));
    const res = await post(admin, `/api/admin/users/${f.staff.id}/reset-password`, {
      temporaryPassword: TEMP,
      version: await versionOf(f.staff.id),
    });
    expect(res.status).toBe(200);
    expect((await old.get("/api/auth/me")).status).toBe(401);
    expect((await (await login(f.staff.email, TEMP)).get("/api/auth/me")).body.mustChangePassword).toBe(true);

    // Người bị đặt lại mật khẩu được báo (cảnh báo an ninh): job tạo thông báo đã vào hàng đợi sau commit.
    const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queue = new Queue(QUEUES.notifications, { connection });
    try {
      const job = await queue.getJob(`notify-password-reset-${f.staff.id}-v${res.body.version}`);
      expect(job?.data).toEqual({
        type: "account.password_reset",
        userIds: [f.staff.id],
        data: { resetByName: "Quản trị" },
        dedupeKey: `password-reset-${f.staff.id}-v${res.body.version}`,
      });
    } finally {
      await queue.close();
      await connection.quit();
    }
  });

  it("gỡ tạm khóa do đăng nhập sai", async () => {
    const admin = await login(f.admin.email);
    await handle.db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(users.id, f.staff.id));
    expect((await post(admin, `/api/admin/users/${f.staff.id}/unlock`, {})).status).toBe(200);
    await login(f.staff.email);
  });

  it("không tự khóa mình, không tự đổi vai trò của mình", async () => {
    const admin = await login(f.admin.email);
    const self = await post(admin, `/api/admin/users/${f.admin.id}/active`, { isActive: false, version: 1 });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("USER_SELF_ACTION");
    const roles = await patch(admin, `/api/admin/users/${f.admin.id}`, {
      fullName: "Quản trị",
      departmentId: null,
      roleIds: [f.roleIds.STAFF],
      version: 1,
    });
    expect(roles.body.code).toBe("USER_SELF_ACTION");
  });

  it("phòng ban ngừng dùng thì không gán người mới vào", async () => {
    const admin = await login(f.admin.email);
    await post(admin, "/api/admin/departments", { code: "NS", name: "Nhân sự" });
    const dept = (await admin.get("/api/admin/departments?q=NS")).body.items[0];
    await patch(admin, `/api/admin/departments/${dept.id}`, { name: "Nhân sự", isActive: false, version: 1 });
    const res = await post(admin, "/api/admin/users", newUser({ departmentId: dept.id }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("DEPARTMENT_INACTIVE");
  });
});

describe("Chống leo thang quyền", () => {
  /** Người quản lý tài khoản (chỉ users.manage): gán được vai trò nghiệp vụ, không cấp được quyền quản trị. */
  async function hrAgent() {
    const admin = await login(f.admin.email);
    const role = await post(admin, "/api/admin/roles", {
      name: "Nhân sự",
      description: "Quản lý tài khoản",
      permissions: ["users.manage"],
    });
    expect(role.status).toBe(201);
    const hr = await post(
      admin,
      "/api/admin/users",
      newUser({ email: "hr@test.vn", roleIds: [role.body.id] }),
    );
    const a = await login("hr@test.vn", TEMP);
    await post(a, "/api/auth/change-password", {
      currentPassword: TEMP,
      newPassword: "mat-khau-nhan-su-moi",
    });
    return { a, hrId: hr.body.id as string };
  }

  it("gán được vai trò không chứa quyền quản trị (vai trò nghiệp vụ) dù bản thân không có quyền đó", async () => {
    const { a } = await hrAgent();
    const res = await post(a, "/api/admin/users", newUser({ roleIds: [f.roleIds.STAFF] }));
    expect(res.status).toBe(201);
  });

  it("không cấp được vai trò chứa quyền quản trị mình chưa có", async () => {
    const { a } = await hrAgent();
    const res = await post(a, "/api/admin/users", newUser({ roleIds: [f.roleIds.ADMIN] }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_ESCALATION");
    const options = (await a.get("/api/admin/users/options")).body;
    expect(options.roles.find((r: { id: string }) => r.id === f.roleIds.ADMIN).assignable).toBe(false);
  });

  it("không thao tác được trên tài khoản mạnh hơn mình (chiếm quyền qua đặt lại mật khẩu)", async () => {
    const { a } = await hrAgent();
    const reset = await post(a, `/api/admin/users/${f.admin.id}/reset-password`, {
      temporaryPassword: "chiem-quyen-admin-1",
      version: 1,
    });
    expect(reset.status).toBe(403);
    expect(reset.body.code).toBe("PERMISSION_ESCALATION");
    const off = await post(a, `/api/admin/users/${f.admin.id}/active`, { isActive: false, version: 1 });
    expect(off.status).toBe(403);
  });

  it("vai trò: không đưa quyền quản trị mình chưa có vào vai trò", async () => {
    const admin = await login(f.admin.email);
    const role = await post(admin, "/api/admin/roles", { name: "Phân quyền", permissions: ["roles.manage"] });
    await post(admin, "/api/admin/users", newUser({ email: "rm@test.vn", roleIds: [role.body.id] }));
    const rm = await login("rm@test.vn", TEMP);
    await post(rm, "/api/auth/change-password", {
      currentPassword: TEMP,
      newPassword: "mat-khau-phan-quyen",
    });
    const res = await post(rm, "/api/admin/roles", { name: "Leo thang", permissions: ["users.manage"] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PERMISSION_ESCALATION");
    expect(
      (await post(rm, "/api/admin/roles", { name: "Duyệt chi", permissions: BUSINESS ? [BUSINESS] : [] }))
        .status,
    ).toBe(201);
  });
});

describe("Vai trò", () => {
  it("vai trò hệ thống: không xóa, không đổi tên, không gỡ quyền quản trị bắt buộc", async () => {
    const admin = await login(f.admin.email);
    const sys = (await admin.get(`/api/admin/roles/${f.roleIds.ADMIN}`)).body;
    expect((await del(admin, `/api/admin/roles/${sys.id}`)).body.code).toBe("ROLE_SYSTEM");
    const rename = await patch(admin, `/api/admin/roles/${sys.id}`, { ...sys, name: "Đổi tên" });
    expect(rename.body.code).toBe("ROLE_SYSTEM");
    // Gỡ quyền bắt buộc: thử bằng quản trị viên KHÁC (người giữ vai trò hệ thống đã bị chặn bởi BR-A7).
    const { c } = await deputyAdmin();
    const strip = await patch(c, `/api/admin/roles/${sys.id}`, { ...sys, permissions: ["users.manage"] });
    expect(strip.body.code).toBe("ROLE_SYSTEM");
  });

  it("tên trùng: 409; quyền không có trong danh mục: 400; xóa vai trò còn người dùng: 409", async () => {
    const admin = await login(f.admin.email);
    expect(
      (await post(admin, "/api/admin/roles", { name: "nhân viên (TEST)", permissions: [] })).body.code,
    ).toBe("ROLE_NAME_TAKEN");
    expect(
      (await post(admin, "/api/admin/roles", { name: "X", permissions: ["khong.ton.tai"] })).status,
    ).toBe(400);
    expect((await del(admin, `/api/admin/roles/${f.roleIds.STAFF}`)).body.code).toBe("ROLE_IN_USE");
  });

  it("danh mục quyền theo nhóm và số người dùng mỗi vai trò", async () => {
    const admin = await login(f.admin.email);
    const groups = (await admin.get("/api/admin/permissions")).body;
    expect(groups[0].group).toBe("Quản trị hệ thống");
    expect(groups.map((g: { group: string }) => g.group)).toEqual([
      ...new Set(Object.values(PERMISSIONS).map((p) => p.group)),
    ]);
    const roles = (await admin.get("/api/admin/roles")).body.items;
    expect(roles.find((r: { id: string }) => r.id === f.roleIds.STAFF).userCount).toBe(2);
  });

  /** C quản trị qua vai trò thường "Quản trị phụ" (đủ mọi quyền quản trị, không phải vai trò hệ thống). */
  async function deputyAdmin() {
    const admin = await login(f.admin.email);
    const role = await post(admin, "/api/admin/roles", {
      name: "Quản trị phụ",
      permissions: ["users.manage", "roles.manage", "departments.manage"],
    });
    await post(admin, "/api/admin/users", newUser({ email: "c@test.vn", roleIds: [role.body.id] }));
    const c = await login("c@test.vn", TEMP);
    await post(c, "/api/auth/change-password", { currentPassword: TEMP, newPassword: "mat-khau-cua-c-123" });
    return { admin, c, role: role.body as { id: string; version: number } };
  }

  it("không sửa quyền của vai trò mình đang giữ (tự cấp quyền qua vai trò của mình)", async () => {
    const { admin, c, role } = await deputyAdmin();
    const strip = await patch(c, `/api/admin/roles/${role.id}`, {
      name: "Quản trị phụ",
      description: "",
      permissions: ["users.manage", "roles.manage"],
      version: role.version,
    });
    expect(strip.status).toBe(403);
    expect(strip.body.code).toBe("ROLE_SELF_EDIT");
    const sys = (await admin.get(`/api/admin/roles/${f.roleIds.ADMIN}`)).body;
    const self = await patch(admin, `/api/admin/roles/${sys.id}`, {
      ...sys,
      permissions: sys.permissions.filter((p: string) => p !== "departments.manage"),
    });
    expect(self.body.code).toBe("ROLE_SELF_EDIT");
  });

  it.runIf(BUSINESS)("vai trò hệ thống chỉ chứa quyền quản trị (tách biệt nhiệm vụ)", async () => {
    const { c } = await deputyAdmin();
    const sys = (await c.get(`/api/admin/roles/${f.roleIds.ADMIN}`)).body;
    const res = await patch(c, `/api/admin/roles/${sys.id}`, {
      ...sys,
      permissions: [...sys.permissions, BUSINESS!],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ROLE_SYSTEM");
  });

  it("không tự đổi phòng ban của mình", async () => {
    const admin = await login(f.admin.email);
    const res = await patch(admin, `/api/admin/users/${f.admin.id}`, {
      fullName: "Quản trị",
      departmentId: f.deptKd,
      roleIds: [f.roleIds.ADMIN],
      version: 1,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_SELF_ACTION");
  });

  it("bất biến quản trị đếm người có CẢ users.manage và roles.manage", async () => {
    // Chỉ còn roles.manage thì không ai cấp lại được users.manage: phải coi như đã mất quản trị.
    await handle.db
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, f.roleIds.ADMIN), eq(rolePermissions.permission, "users.manage")),
      );
    await expect(handle.db.transaction((tx) => assertAdminRemains(tx))).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
  });

  it("khôi phục quản trị từ máy chủ (grant-admin): kích hoạt lại, gán vai trò hệ thống, gỡ tạm khóa", async () => {
    await handle.db
      .update(users)
      .set({ isActive: false, lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(users.id, f.admin.id));
    await handle.db.delete(userRoles).where(eq(userRoles.userId, f.admin.id));
    await grantAdmin(handle.db, f.admin.email.toUpperCase());
    const me = (await (await login(f.admin.email)).get("/api/auth/me")).body;
    expect(me.permissions).toContain("users.manage");
    expect(me.permissions).toContain("roles.manage");
    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "user.grant_admin"));
    expect(audits).toHaveLength(1);
    await expect(grantAdmin(handle.db, "khong-ton-tai@test.vn")).rejects.toThrow(/Không có tài khoản/);
  });
});

describe("Phòng ban", () => {
  it("tạo (mã viết hoa), mã trùng 409, sửa và ngừng dùng; danh sách có số người", async () => {
    const admin = await login(f.admin.email);
    const res = await post(admin, "/api/admin/departments", { code: "ns", name: "Nhân sự" });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe("NS");
    expect((await post(admin, "/api/admin/departments", { code: "NS", name: "Trùng" })).body.code).toBe(
      "DEPARTMENT_CODE_TAKEN",
    );
    const kd = (await admin.get("/api/admin/departments?q=KD")).body.items[0];
    expect(kd.userCount).toBe(2); // staff, staff2
    const off = await patch(admin, `/api/admin/departments/${res.body.id}`, {
      name: "Phòng Nhân sự",
      isActive: false,
      version: 1,
    });
    expect(off.body).toMatchObject({ name: "Phòng Nhân sự", isActive: false, version: 2 });
  });
});
