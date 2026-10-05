import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, purchaseRequests, type DbHandle } from "@app/db";
import { DIRECTOR_APPROVAL_THRESHOLD_VND } from "@app/shared";
import { openDb, resetDb } from "../helpers.js";
import { type SampleFixture, seedSampleFixture } from "./fixture.js";
import { BusinessError } from "../../src/common/business-error.js";
import { PurchaseRequestsService } from "../../src/modules/purchase-requests/purchase-requests.service.js";

const handle: DbHandle = openDb();
const jobs: unknown[] = [];
const fakeQueue = { add: async (_n: string, data: unknown) => (jobs.push(data), {}) } as never;
const service = new PurchaseRequestsService(handle.db, fakeQueue);
let f: SampleFixture;

const input = (amount = 1_000_000) => ({
  title: "Mua văn phòng phẩm quý 4",
  items: [{ name: "Giấy A4", quantity: 1, unitPrice: amount }],
});

beforeEach(async () => {
  await resetDb(handle);
  jobs.length = 0;
  f = await seedSampleFixture(handle);
});
afterAll(() => handle.close());

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof BusinessError ? e.code : String(e);
  }
};

describe("PurchaseRequestsService (PostgreSQL thật)", () => {
  it("luồng đầy đủ dưới ngưỡng: tạo -> gửi -> trưởng phòng duyệt, mỗi bước có audit", async () => {
    const created = await service.create(f.staff, input(), "127.0.0.1");
    expect(created.code).toMatch(/^PR-\d{4}-\d{6}$/);
    const submitted = await service.transition(f.staff, created.id, { event: "SUBMIT", version: 1 }, null);
    const approved = await service.transition(
      f.manager,
      created.id,
      { event: "MANAGER_APPROVE", version: submitted.version },
      null,
    );
    expect(approved.status).toBe("APPROVED");

    const audits = await handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id));
    expect(audits.map((a) => a.action)).toEqual(["pr.create", "pr.submit", "pr.manager_approve"]);
    expect(jobs).toHaveLength(2);
  });

  it("BR-03: vượt ngưỡng phải qua giám đốc", async () => {
    const pr = await service.create(f.staff, input(DIRECTOR_APPROVAL_THRESHOLD_VND + 1), null);
    await service.transition(f.staff, pr.id, { event: "SUBMIT", version: 1 }, null);
    const r = await service.transition(f.manager, pr.id, { event: "MANAGER_APPROVE", version: 2 }, null);
    expect(r.status).toBe("PENDING_DIRECTOR");
    const done = await service.transition(f.director, pr.id, { event: "DIRECTOR_APPROVE", version: 3 }, null);
    expect(done.status).toBe("APPROVED");
  });

  it("hàng đợi treo (Redis mất kết nối) không làm treo thao tác đã commit", async () => {
    const stuck = new PurchaseRequestsService(handle.db, { add: () => new Promise(() => {}) } as never);
    const pr = await stuck.create(f.staff, input(), null);
    const started = Date.now();
    const r = await stuck.transition(f.staff, pr.id, { event: "SUBMIT", version: 1 }, null);
    expect(r.status).toBe("PENDING_MANAGER");
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("BR-06: sai version bị từ chối 409 và không ghi audit", async () => {
    const pr = await service.create(f.staff, input(), null);
    expect(await codeOf(service.transition(f.staff, pr.id, { event: "SUBMIT", version: 99 }, null))).toBe(
      "VERSION_CONFLICT",
    );
    const audits = await handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, pr.id), eq(auditLogs.action, "pr.submit")));
    expect(audits).toHaveLength(0);
  });

  it("BR-06: hai người duyệt cùng lúc, chỉ một người thành công", async () => {
    const pr = await service.create(f.staff, input(), null);
    await service.transition(f.staff, pr.id, { event: "SUBMIT", version: 1 }, null);
    const results = await Promise.all([
      codeOf(service.transition(f.manager, pr.id, { event: "MANAGER_APPROVE", version: 2 }, null)),
      codeOf(
        service.transition(
          f.manager,
          pr.id,
          { event: "REJECT", version: 2, reason: "Thiếu báo giá nhà cung cấp" },
          null,
        ),
      ),
    ]);
    expect(results.sort()).toEqual(["OK", "VERSION_CONFLICT"]);
    const [row] = await handle.db.select().from(purchaseRequests).where(eq(purchaseRequests.id, pr.id));
    expect(row!.version).toBe(3);
  });

  it("BR-07: người ngoài phạm vi nhận 404, không lộ phiếu tồn tại", async () => {
    const pr = await service.create(f.staff, input(), null);
    expect(await codeOf(service.get(f.staff2, pr.id))).toBe("PR_NOT_FOUND");
    expect(await codeOf(service.get(f.managerKt, pr.id))).toBe("PR_NOT_FOUND");
    expect(await codeOf(service.get(f.manager, pr.id))).toBe("OK");
    const list = await service.list(f.staff2, { page: 1, pageSize: 20, sort: "createdAt", order: "desc" });
    expect(list.total).toBe(0);
  });

  it("danh sách: tìm theo mã/tiêu đề (ký tự % _ là chữ thường), lọc trạng thái, sắp xếp ổn định", async () => {
    const mk = async (title: string, amount: number) =>
      service.create(f.staff, { ...input(amount), title }, null);
    const a = await mk("Mua giấy in 50% giá", 3_000_000);
    const b = await mk("Mua 50 cây bút bi", 1_000_000);
    await mk("Mua bàn ghế phòng họp", 2_000_000);
    await service.transition(f.staff, a.id, { event: "SUBMIT", version: 1 }, null);
    const list = (q: object) =>
      service.list(f.staff, { page: 1, pageSize: 20, sort: "createdAt", order: "desc", ...q });

    expect((await list({ q: "50%" })).items.map((x) => x.id)).toEqual([a.id]);
    expect((await list({ q: "50" })).total).toBe(2);
    expect((await list({ q: b.code.toLowerCase() })).items.map((x) => x.id)).toEqual([b.id]);
    expect((await list({ status: "PENDING_MANAGER" })).items.map((x) => x.id)).toEqual([a.id]);
    expect((await list({ sort: "totalAmount", order: "asc" })).items.map((x) => x.totalAmount)).toEqual([
      1_000_000, 2_000_000, 3_000_000,
    ]);
    // Tìm kiếm không vượt phạm vi xem: người khác không thấy dù gõ đúng mã.
    expect(
      (await service.list(f.staff2, { page: 1, pageSize: 20, sort: "createdAt", order: "desc", q: a.code }))
        .total,
    ).toBe(0);
  });

  it("BR-01: chỉ sửa được phiếu nháp của chính mình", async () => {
    const pr = await service.create(f.staff, input(), null);
    expect(await codeOf(service.update(f.staff2, pr.id, { ...input(), version: 1 }, null))).toBe(
      "PR_NOT_FOUND",
    );
    const updated = await service.update(f.staff, pr.id, { ...input(2_000_000), version: 1 }, null);
    expect(updated.totalAmount).toBe(2_000_000);
    await service.transition(f.staff, pr.id, { event: "SUBMIT", version: 2 }, null);
    expect(await codeOf(service.update(f.staff, pr.id, { ...input(), version: 3 }, null))).toBe(
      "PR_NOT_EDITABLE",
    );
  });
});
