import type { INestApplication } from "@nestjs/common";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, exportJobs, type DbHandle } from "@app/db";
import { LocalFileStorage, storeFile } from "@app/server";
import { QUEUES } from "@app/shared";
import { createApp } from "../src/bootstrap.js";
import {
  nextIp,
  openDb,
  resetDb,
  seedFixture,
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_STORAGE_DIR,
  makeUser,
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
  queue = new Queue(QUEUES.exports, { connection: redis });
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
const XLSX = { type: "admin.users.xlsx", params: { status: "active" } };
const requestExport = (a: Agent, body: object) =>
  a.post("/api/exports").set("Origin", TEST_ORIGIN).send(body);

/** Giả lập worker đã chạy xong: gắn một tệp vào yêu cầu (worker thật được kiểm ở apps/worker). */
async function completeWith(exportId: string, userId: string, expiresAt: Date) {
  const storage = new LocalFileStorage(TEST_STORAGE_DIR);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const { row } = await storeFile(handle.db, storage, {
    buffer: pdf,
    originalName: "nguoi-dung.pdf",
    allowed: ["pdf"],
    maxBytes: 1024 * 1024,
    uploadedBy: userId,
    entityType: "export_job",
    entityId: exportId,
  });
  await handle.db
    .update(exportJobs)
    .set({ status: "DONE", fileId: row.id, rowCount: 1, finishedAt: new Date(), expiresAt })
    .where(eq(exportJobs.id, exportId));
}

describe("xuất file (spec 002)", () => {
  it("người có quyền yêu cầu xuất Excel: tạo yêu cầu QUEUED, đẩy job theo id, có audit", async () => {
    const manager = await login(f.admin.email);
    const res = await requestExport(manager, XLSX);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: "admin.users.xlsx", status: "QUEUED", downloadable: false });
    const job = await queue.getJob(`export-${res.body.id}`);
    expect(job?.data).toEqual({ exportId: res.body.id });
    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "export.request"));
    expect(audits).toHaveLength(1);
    // Tham số lưu là bản đã validate (có giá trị mặc định), worker chạy đúng như vậy.
    expect(audits[0]!.after).toEqual({
      type: "admin.users.xlsx",
      params: { status: "active", sort: "fullName", order: "asc" },
    });
  });

  it("thiếu quyền của loại xuất: 403; loại xuất lạ hoặc tham số sai: 400", async () => {
    const staff = await login(f.staff.email);
    expect((await requestExport(staff, XLSX)).status).toBe(403);
    expect((await requestExport(staff, { type: "users.xlsx", params: {} })).status).toBe(400);
    const manager = await login(f.admin.email);
    expect((await requestExport(manager, { ...XLSX, params: { sort: "password_hash" } })).status).toBe(400);
    expect(await handle.db.select().from(exportJobs)).toHaveLength(0);
  });

  it(`tối đa 3 lần xuất chưa xong mỗi người: lần thứ 4 bị 429`, async () => {
    const manager = await login(f.admin.email);
    for (let i = 0; i < 3; i++) expect((await requestExport(manager, XLSX)).status).toBe(201);
    const fourth = await requestExport(manager, XLSX);
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe("EXPORT_TOO_MANY");
  });

  it("chỉ người yêu cầu thấy và tải được; tải có audit; hết hạn: 410; chưa xong: 409", async () => {
    const manager = await login(f.admin.email);
    const done = (await requestExport(manager, XLSX)).body.id as string;
    const pending = (await requestExport(manager, XLSX)).body.id as string;
    const expired = (await requestExport(manager, XLSX)).body.id as string;
    await completeWith(done, f.admin.id, new Date(Date.now() + 60_000));
    await completeWith(expired, f.admin.id, new Date(Date.now() - 1000));

    const list = await manager.get("/api/exports");
    expect(list.body.map((e: { id: string }) => e.id).sort()).toEqual([done, pending, expired].sort());
    const doneDto = list.body.find((e: { id: string }) => e.id === done);
    expect(doneDto).toMatchObject({ status: "DONE", downloadable: true, fileName: "nguoi-dung.pdf" });
    expect(list.body.find((e: { id: string }) => e.id === expired).downloadable).toBe(false);

    const dl = await manager.get(`/api/exports/${done}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; /);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "export.download"));
    expect(audits).toHaveLength(1);

    expect((await manager.get(`/api/exports/${pending}/download`)).status).toBe(409);
    const gone = await manager.get(`/api/exports/${expired}/download`);
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe("EXPORT_EXPIRED");

    // Người khác, kể cả người xem được mọi phiếu: không thấy, không tải được (404).
    const otherAdmin = await makeUser(handle, {
      email: "admin2@test.vn",
      fullName: "Quản trị 2",
      permissions: ["users.manage"],
    });
    const director = await login(otherAdmin.email);
    expect((await director.get(`/api/exports/${done}`)).status).toBe(404);
    expect((await director.get(`/api/exports/${done}/download`)).status).toBe(404);
    expect((await director.get("/api/exports")).body).toEqual([]);
  });
});
