import type { INestApplication } from "@nestjs/common";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, importJobs, type DbHandle } from "@app/db";
import { buildImportTemplate } from "@app/server";
import { QUEUES } from "@app/shared";
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
let redis: Redis;
let queue: Queue;

beforeAll(async () => {
  handle = openDb();
  app = await createApp(testEnv(), { logger: false });
  await app.init();
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  queue = new Queue(QUEUES.imports, { connection: redis });
});
afterAll(async () => {
  await queue.close();
  await redis.quit();
  await app.close();
  await handle.close();
});
beforeEach(async () => {
  await queue.obliterate({ force: true });
  await resetDb(handle);
  f = await seedFixture(handle);
});

type Agent = ReturnType<typeof request.agent>;
async function login(email: string): Promise<Agent> {
  const a = request.agent(app.getHttpServer());
  const res = await a
    .post("/api/auth/login")
    .set("Origin", TEST_ORIGIN)
    .set("X-Forwarded-For", nextIp())
    .send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return a;
}
/** Tệp xlsx hợp lệ (API không đọc nội dung; worker kiểm, xem apps/worker). */
const xlsx = () => buildImportTemplate("departments");
const binary = (r: request.Request) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
const upload = async (a: Agent, content: Buffer, name = "phong-ban.xlsx") =>
  a.post("/api/imports/types/departments").set("Origin", TEST_ORIGIN).attach("file", content, name);

describe("nhập Excel qua API (spec 003)", () => {
  it("tệp mẫu: người có quyền tải được (xlsx, attachment); không có quyền: 403; loại lạ: 400", async () => {
    const admin = await login(f.admin.email);
    const tpl = await binary(admin.get("/api/imports/types/departments/template"));
    expect(tpl.status).toBe(200);
    expect(tpl.headers["content-disposition"]).toMatch(/^attachment; .*mau-nhap-departments\.xlsx/);
    expect((tpl.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const staff = await login(f.staff.email);
    expect((await staff.get("/api/imports/types/departments/template")).status).toBe(403);
    expect((await admin.get("/api/imports/types/users/template")).status).toBe(400);
  });

  it("tải lên: VALIDATING, đẩy job kiểm, có audit; không phải xlsx: 415; không có quyền: 403", async () => {
    const admin = await login(f.admin.email);
    const res = await upload(admin, await xlsx());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: "departments", status: "VALIDATING", fileName: "phong-ban.xlsx" });
    expect((await queue.getJob(`import.validate-${res.body.id}`))?.data).toEqual({ importId: res.body.id });
    expect(
      await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "import.upload")),
    ).toHaveLength(1);

    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    expect((await upload(admin, pdf, "phong-ban.xlsx")).status).toBe(415);
    const staff = await login(f.staff.email);
    expect((await upload(staff, await xlsx())).status).toBe(403);
  });

  it("tệp vượt FILE_MAX_MB (môi trường test 1 MB): 413, không tạo yêu cầu nhập", async () => {
    const admin = await login(f.admin.email);
    const big = Buffer.concat([await xlsx(), Buffer.alloc(1024 * 1024 + 10)]);
    expect((await upload(admin, big)).status).toBe(413);
    expect(await handle.db.select().from(importJobs)).toHaveLength(0);
  });

  it("xác nhận: chỉ khi READY (409 nếu chưa); bấm hai lần song song chỉ một lần được nhận; người khác: 404", async () => {
    const admin = await login(f.admin.email);
    const id = (await upload(admin, await xlsx())).body.id as string;
    expect((await admin.post(`/api/imports/${id}/commit`).set("Origin", TEST_ORIGIN)).status).toBe(409);

    await handle.db.update(importJobs).set({ status: "READY", totalRows: 1 }).where(eq(importJobs.id, id));
    const [a, b] = await Promise.all([
      admin.post(`/api/imports/${id}/commit`).set("Origin", TEST_ORIGIN),
      admin.post(`/api/imports/${id}/commit`).set("Origin", TEST_ORIGIN),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await queue.getJob(`import.commit-${id}`))?.data).toEqual({ importId: id });
    expect(
      await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "import.confirm")),
    ).toHaveLength(1);

    // Người khác: không xem, không xác nhận, không hủy được lần nhập này.
    const manager = await login(f.staff2.email);
    expect((await manager.get(`/api/imports/${id}`)).status).toBe(404);
    expect((await manager.post(`/api/imports/${id}/cancel`).set("Origin", TEST_ORIGIN)).status).toBe(404);
  });

  it("hủy: chỉ khi đang chờ xác nhận", async () => {
    const admin = await login(f.admin.email);
    const id = (await upload(admin, await xlsx())).body.id as string;
    expect((await admin.post(`/api/imports/${id}/cancel`).set("Origin", TEST_ORIGIN)).status).toBe(409);
    await handle.db.update(importJobs).set({ status: "READY" }).where(eq(importJobs.id, id));
    const res = await admin.post(`/api/imports/${id}/cancel`).set("Origin", TEST_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });
});
