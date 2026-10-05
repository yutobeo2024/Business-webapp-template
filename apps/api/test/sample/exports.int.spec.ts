/** Xuất file của module MẪU (in PDF phiếu đề nghị); xóa cùng mẫu bởi `pnpm sample:remove`. */
import type { INestApplication } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DbHandle } from "@app/db";
import { QUEUES } from "@app/shared";
import { createApp } from "../../src/bootstrap.js";
import { nextIp, openDb, resetDb, TEST_ORIGIN, TEST_PASSWORD, testEnv } from "../helpers.js";
import { type SampleFixture, seedSampleFixture } from "./fixture.js";

let app: INestApplication;
let handle: DbHandle;
let f: SampleFixture;
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
  f = await seedSampleFixture(handle);
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
const requestExport = (a: Agent, body: object) =>
  a.post("/api/exports").set("Origin", TEST_ORIGIN).send(body);

describe("xuất PDF phiếu đề nghị (mẫu)", () => {
  it("in PDF: phiếu xem được thì in được (không cần pr.export); ngoài phạm vi: 404", async () => {
    const staff = await login(f.staff.email);
    const created = await staff
      .post("/api/purchase-requests")
      .set("Origin", TEST_ORIGIN)
      .send({ title: "Mua máy in", items: [{ name: "Máy in", quantity: 1, unitPrice: 5_000_000 }] });
    const pdf = { type: "purchase-request.pdf", params: { id: created.body.id } };
    expect((await requestExport(staff, pdf)).status).toBe(201);
    const other = await login(f.staff2.email);
    expect((await requestExport(other, pdf)).status).toBe(404);
  });
});
