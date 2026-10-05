import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users, type DbHandle } from "@app/db";
import { createApp } from "../src/bootstrap.js";
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

const agent = () => request.agent(app.getHttpServer());

async function login(email: string) {
  const a = agent();
  const res = await a
    .post("/api/auth/login")
    .set("Origin", TEST_ORIGIN)
    .set("X-Forwarded-For", nextIp())
    .send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return a;
}

/** Tài khoản bị khóa trả đúng thông báo của sai mật khẩu (không lộ email tồn tại), và DB ghi nhận khóa. */
async function expectLocked(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  const [u] = await handle.db.select().from(users).where(eq(users.id, f.staff.id));
  expect(u!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
}

describe("HTTP API (app thật, DB + Redis thật)", () => {
  it("health trả 200 khi DB và Redis sẵn sàng", async () => {
    const res = await agent().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok", redis: "ok" } });
  });

  it("endpoint mặc định yêu cầu đăng nhập", async () => {
    const res = await agent().get("/api/notifications");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
  it("cookie phiên là httpOnly và SameSite=Lax", async () => {
    const res = await agent()
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: TEST_PASSWORD });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("sai mật khẩu trả thông báo chung, không lộ email có tồn tại hay không", async () => {
    const a = await agent()
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: "sai-mat-khau" });
    const b = await agent()
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: "khong-ton-tai@test.vn", password: "sai-mat-khau" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("đăng nhập thất bại luôn mất tối thiểu một khoảng cố định (không dò được email qua thời gian phản hồi)", async () => {
    const timeOf = async (email: string) => {
      const started = Date.now();
      await agent()
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .set("X-Forwarded-For", nextIp())
        .send({ email, password: "sai-mat-khau" });
      return Date.now() - started;
    };
    expect(await timeOf("khong-ton-tai@test.vn")).toBeGreaterThanOrEqual(190);
    expect(await timeOf(f.staff.email)).toBeGreaterThanOrEqual(190);
  });

  it("khóa tài khoản sau 5 lần sai", async () => {
    for (let i = 0; i < 5; i++) {
      await agent()
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .set("X-Forwarded-For", nextIp())
        .send({ email: f.staff.email, password: "sai-mat-khau" });
    }
    const res = await agent()
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: TEST_PASSWORD });
    await expectLocked(res);
  });

  it("khóa tài khoản khi đăng nhập sai song song (bộ đếm không bị ghi đè)", async () => {
    // Trước đây: đọc failedLoginCount rồi ghi giá trị tuyệt đối, N request song song chỉ tăng bộ đếm 1 lần.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        agent()
          .post("/api/auth/login")
          .set("Origin", TEST_ORIGIN)
          .set("X-Forwarded-For", nextIp())
          .send({ email: f.staff.email, password: "sai-mat-khau" }),
      ),
    );
    const res = await agent()
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: TEST_PASSWORD });
    await expectLocked(res);
  });

  it("phiên quá hạn tuyệt đối bị từ chối dù vẫn đang hoạt động", async () => {
    const a = await login(f.staff.email);
    expect((await a.get("/api/auth/me")).status).toBe(200);
    await handle.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 3600_000) })
      .where(eq(sessions.userId, f.staff.id));
    expect((await a.get("/api/auth/me")).status).toBe(401);
  });

  it("phiên được gia hạn thì cookie cũng được gia hạn", async () => {
    const a = await login(f.staff.email);
    expect((await a.get("/api/auth/me")).headers["set-cookie"]).toBeUndefined();
    await handle.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(sessions.userId, f.staff.id));
    const res = await a.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(String(res.headers["set-cookie"])).toMatch(/sid=.*HttpOnly/i);
  });

  it("body quá 1MB trả 413, không phải lỗi 500", async () => {
    const a = await login(f.admin.email);
    const res = await a
      .post("/api/admin/departments")
      .set("Origin", TEST_ORIGIN)
      .send({ code: "X", name: "x".repeat(1_200_000) });
    expect(res.status).toBe(413);
  });
  it("CSRF: Referer sai định dạng bị chặn 403, không phải lỗi 500", async () => {
    const res = await agent()
      .post("/api/auth/login")
      .set("Referer", "khong-phai-url")
      .set("X-Forwarded-For", nextIp())
      .send({ email: f.staff.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_REJECTED");
  });

  it("CSRF: request ghi không có Origin hợp lệ bị chặn", async () => {
    const a = await login(f.staff.email);
    const res = await a.post("/api/notifications/read-all").set("Origin", "https://evil.example").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_REJECTED");
  });
  it("validate input trả 400 với chi tiết tiếng Việt", async () => {
    const a = await login(f.admin.email);
    const res = await a
      .post("/api/admin/departments")
      .set("Origin", TEST_ORIGIN)
      .send({ code: "mã sai!", name: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body.details)).toContain("Mã phòng ban gồm chữ không dấu");
  });
  it("danh sách: cột sắp xếp không cho phép trả 400", async () => {
    const res = await (await login(f.admin.email)).get("/api/admin/users?sort=password_hash");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });
  it("id sai định dạng trả 400, không phải 500", async () => {
    const a = await login(f.admin.email);
    const res = await a.get("/api/admin/users/khong-phai-uuid");
    expect(res.status).toBe(400);
  });
  it("rate limit đăng nhập: quá 10 lần/phút từ cùng một IP bị chặn 429", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await agent()
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .set("X-Forwarded-For", ip)
        .send({ email: "khong-ton-tai@test.vn", password: "sai-mat-khau" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("đăng xuất xóa phiên", async () => {
    const a = await login(f.staff.email);
    expect((await a.post("/api/auth/logout").set("Origin", TEST_ORIGIN)).status).toBe(204);
    expect((await a.get("/api/auth/me")).status).toBe(401);
  });
});
