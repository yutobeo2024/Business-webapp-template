/** HTTP của module MẪU phiếu đề nghị (xóa cùng mẫu bởi `pnpm sample:remove`). */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type DbHandle } from "@app/db";
import { createApp } from "../../src/bootstrap.js";
import { nextIp, openDb, resetDb, TEST_ORIGIN, TEST_PASSWORD, testEnv } from "../helpers.js";
import { type SampleFixture, seedSampleFixture } from "./fixture.js";

let app: INestApplication;
let handle: DbHandle;
let f: SampleFixture;

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
  f = await seedSampleFixture(handle);
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

describe("HTTP phiếu đề nghị (mẫu)", () => {
  it("BR-08: giám đốc không lập phiếu (là người duyệt cuối)", async () => {
    const a = await login(f.director.email);
    const res = await a
      .post("/api/purchase-requests")
      .set("Origin", TEST_ORIGIN)
      .send({ title: "Mua bàn ghế phòng họp", items: [{ name: "Bàn", quantity: 1, unitPrice: 1000 }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("tổng tiền vượt giới hạn bị từ chối 400, không lưu sai hoặc lỗi 500", async () => {
    const a = await login(f.staff.email);
    const res = await a
      .post("/api/purchase-requests")
      .set("Origin", TEST_ORIGIN)
      .send({
        title: "Phiếu tổng tiền khổng lồ",
        items: [{ name: "Hàng", quantity: 1_000_000, unitPrice: 9_000_000_000_000_000 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("luồng tạo -> gửi -> duyệt qua HTTP", async () => {
    const staff = await login(f.staff.email);
    const created = await staff
      .post("/api/purchase-requests")
      .set("Origin", TEST_ORIGIN)
      .send({
        title: "Mua máy chiếu phòng họp",
        items: [{ name: "Máy chiếu", quantity: 1, unitPrice: 15_000_000 }],
      });
    expect(created.status).toBe(201);
    expect(created.body.allowedEvents).toEqual(["SUBMIT", "CANCEL"]);

    const submitted = await staff
      .post(`/api/purchase-requests/${created.body.id}/transitions`)
      .set("Origin", TEST_ORIGIN)
      .send({ event: "SUBMIT", version: 1 });
    expect(submitted.status).toBe(201);

    const manager = await login(f.manager.email);
    const approved = await manager
      .post(`/api/purchase-requests/${created.body.id}/transitions`)
      .set("Origin", TEST_ORIGIN)
      .send({ event: "MANAGER_APPROVE", version: 2 });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("APPROVED");
  });
});
