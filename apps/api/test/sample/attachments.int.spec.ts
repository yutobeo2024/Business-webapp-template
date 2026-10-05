import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, files, type DbHandle } from "@app/db";
import { LocalFileStorage } from "@app/server";
import { createApp } from "../../src/bootstrap.js";
import {
  nextIp,
  openDb,
  resetDb,
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_STORAGE_DIR,
  testEnv,
} from "../helpers.js";
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
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const upload = (a: Agent, prId: string, content: Buffer, name: string) =>
  a
    .post(`/api/purchase-requests/${prId}/attachments`)
    .set("Origin", TEST_ORIGIN)
    .attach("file", content, name);

async function draftOf(a: Agent) {
  const res = await a
    .post("/api/purchase-requests")
    .set("Origin", TEST_ORIGIN)
    .send({ title: "Mua máy in văn phòng", items: [{ name: "Máy in", quantity: 1, unitPrice: 5_000_000 }] });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

describe("BR-09 đính kèm phiếu đề nghị", () => {
  it("người lập đính kèm PDF; người xem được phiếu tải về với header an toàn; có audit", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const res = await upload(staff, pr.id, PDF, "Báo giá Q4.pdf");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Báo giá Q4.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
    });

    const manager = await login(f.manager.email);
    expect((await manager.get(`/api/purchase-requests/${pr.id}/attachments`)).body).toHaveLength(1);
    const dl = await manager
      .get(`/api/purchase-requests/${pr.id}/attachments/${res.body.id}/download`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; .*filename\*=UTF-8''B%C3%A1o/);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");

    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "pr.attachment_add"));
    expect(audits).toHaveLength(1);
  });

  it("nội dung không đúng loại (tệp chạy được đổi đuôi .pdf, HTML): 415, không lưu gì", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const exe = await upload(
      staff,
      pr.id,
      Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 0x90)]),
      "bao-gia.pdf",
    );
    expect(exe.status).toBe(415);
    expect(exe.body.code).toBe("FILE_TYPE_NOT_ALLOWED");
    expect((await upload(staff, pr.id, Buffer.from("<html><script>alert(1)</script>"), "a.pdf")).status).toBe(
      415,
    );
    expect(await handle.db.select().from(files)).toHaveLength(0);
  });

  it("quá dung lượng (FILE_MAX_MB): 413", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    expect((await upload(staff, pr.id, big, "lon.pdf")).status).toBe(413);
  });

  it("thiếu tệp: 400; quá 10 tệp: 409", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const none = await staff.post(`/api/purchase-requests/${pr.id}/attachments`).set("Origin", TEST_ORIGIN);
    expect(none.status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await upload(staff, pr.id, PDF, `t${i}.pdf`)).status).toBe(201);
    const over = await upload(staff, pr.id, PDF, "t10.pdf");
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("PR_ATTACHMENT_LIMIT");
  });

  it("người ngoài phạm vi: 404; người xem được nhưng không phải người lập: 403", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const added = await upload(staff, pr.id, PDF, "a.pdf");
    const other = await login(f.staff2.email);
    expect((await upload(other, pr.id, PDF, "b.pdf")).status).toBe(404);
    expect((await other.get(`/api/purchase-requests/${pr.id}/attachments`)).status).toBe(404);
    expect(
      (await other.get(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}/download`)).status,
    ).toBe(404);
    const manager = await login(f.manager.email);
    expect((await upload(manager, pr.id, PDF, "c.pdf")).status).toBe(403);
  });

  it("phiếu đã gửi: không thêm, không xóa đính kèm (chứng từ đã nộp không đổi được)", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const added = await upload(staff, pr.id, PDF, "a.pdf");
    await staff
      .post(`/api/purchase-requests/${pr.id}/transitions`)
      .set("Origin", TEST_ORIGIN)
      .send({ event: "SUBMIT", version: pr.version });
    expect((await upload(staff, pr.id, PDF, "b.pdf")).body.code).toBe("PR_NOT_EDITABLE");
    const del = await staff
      .delete(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}`)
      .set("Origin", TEST_ORIGIN);
    expect(del.status).toBe(409);
  });

  it("xóa: xóa mềm, không còn trong danh sách, không tải được; tệp của phiếu khác: 404", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const other = await draftOf(staff);
    const added = await upload(staff, pr.id, PDF, "a.pdf");
    expect(
      (
        await staff
          .delete(`/api/purchase-requests/${other.id}/attachments/${added.body.id}`)
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(404);
    expect(
      (
        await staff
          .delete(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}`)
          .set("Origin", TEST_ORIGIN)
      ).status,
    ).toBe(204);
    expect((await staff.get(`/api/purchase-requests/${pr.id}/attachments`)).body).toHaveLength(0);
    expect(
      (await staff.get(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}/download`)).status,
    ).toBe(404);
    const [row] = await handle.db.select().from(files).where(eq(files.id, added.body.id));
    expect(row!.deletedAt).not.toBeNull();
  });

  it("hàng còn mà tệp vật lý đã mất: 410 rõ ràng, không 500; audit xóa ghi storageKey", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    const added = await upload(staff, pr.id, PDF, "a.pdf");
    const [row] = await handle.db.select().from(files).where(eq(files.id, added.body.id));
    await new LocalFileStorage(TEST_STORAGE_DIR).remove(row!.storageKey);
    const dl = await staff.get(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}/download`);
    expect(dl.status).toBe(410);
    expect(dl.body.code).toBe("FILE_GONE");

    await staff
      .delete(`/api/purchase-requests/${pr.id}/attachments/${added.body.id}`)
      .set("Origin", TEST_ORIGIN);
    const [audit] = await handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "pr.attachment_remove"));
    expect(audit!.before).toMatchObject({ fileId: added.body.id, storageKey: row!.storageKey });
  });

  it("DTO phiếu cho biết người xem có quản lý đính kèm được không", async () => {
    const staff = await login(f.staff.email);
    const pr = await draftOf(staff);
    expect((await staff.get(`/api/purchase-requests/${pr.id}`)).body.canManageAttachments).toBe(true);
    const manager = await login(f.manager.email);
    expect((await manager.get(`/api/purchase-requests/${pr.id}`)).body.canManageAttachments).toBe(false);
  });
});
