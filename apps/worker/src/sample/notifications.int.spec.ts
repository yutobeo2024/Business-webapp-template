/**
 * Module MẪU (xóa cùng mẫu): tích hợp thông báo khi phiếu đổi trạng thái (spec 001 mục 7, spec 003): đúng người nhận theo quyền hiện tại, không trùng.
 */
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, notifications, purchaseRequests, rolePermissions, users, type DbHandle } from "@app/db";
import { createProcessor } from "../processors.js";
import { makeUser, resetWorkerDb } from "../testing/fixture.js";
import { makePr } from "./fixture.js";

let handle: DbHandle;
let run: ReturnType<typeof createProcessor>;
let deptKd: string;
let deptKt: string;

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
  run = createProcessor({ db: handle.db, log: pino({ level: "silent" }) });
});
afterAll(() => handle.close());
beforeEach(async () => {
  ({ deptKd, deptKt } = await resetWorkerDb(handle.db));
});

const statusJob = (pr: { id: string; code: string }, to: string, version = 2) =>
  run({
    id: `pr-${pr.id}-v${version}`,
    name: "pr.status_changed",
    data: { purchaseRequestId: pr.id, code: pr.code, from: "DRAFT", to, actorId: pr.id, version },
  } as never);

const inbox = async (userId: string) =>
  handle.db.select().from(notifications).where(eq(notifications.userId, userId));

const MANAGER: Parameters<typeof makeUser>[3] = ["pr.view.department", "pr.approve.department"];

describe("thông báo khi phiếu đổi trạng thái", () => {
  it("chờ trưởng phòng: báo trưởng phòng CÙNG phòng ban, không báo phòng khác, người bị khóa, người lập", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const managerKd = await makeUser(handle.db, "tp-kd", deptKd, MANAGER);
    const managerKt = await makeUser(handle.db, "tp-kt", deptKt, MANAGER);
    const locked = await makeUser(handle.db, "tp-kd-khoa", deptKd, MANAGER);
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, locked.id));
    const pr = await makePr(handle.db, staff.id, deptKd, "Mua giấy <A4>", "PENDING_MANAGER");

    expect(await statusJob(pr, "PENDING_MANAGER")).toBe(1);
    const [n] = await inbox(managerKd.id);
    expect(n).toMatchObject({
      type: "pr.pending_approval",
      title: `Phiếu ${pr.code} chờ bạn duyệt`,
      link: `/purchase-requests?q=${pr.code}`,
    });
    expect(n!.body).toContain("Mua giấy <A4>");
    expect(await inbox(managerKt.id)).toHaveLength(0);
    expect(await inbox(locked.id)).toHaveLength(0);
    expect(await inbox(staff.id)).toHaveLength(0);
  });

  it("job chạy lại không tạo thông báo thứ hai", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const manager = await makeUser(handle.db, "tp", deptKd, MANAGER);
    const pr = await makePr(handle.db, staff.id, deptKd, "Phiếu", "PENDING_MANAGER");
    await statusJob(pr, "PENDING_MANAGER");
    expect(await statusJob(pr, "PENDING_MANAGER")).toBe(0);
    expect(await inbox(manager.id)).toHaveLength(1);
  });

  it("có quyền duyệt nhưng không xem được phiếu: không nhận nội dung phiếu", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const approverNoView = await makeUser(handle.db, "duyet-khong-xem", deptKd, ["pr.approve.department"]);
    const pr = await makePr(handle.db, staff.id, deptKd, "Phiếu", "PENDING_MANAGER");
    await statusJob(pr, "PENDING_MANAGER");
    expect(await inbox(approverNoView.id)).toHaveLength(0);
  });

  it("chờ giám đốc: báo người có quyền duyệt cuối; duyệt: báo người lập; từ chối kèm lý do", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const director = await makeUser(handle.db, "gd", null, ["pr.view.all", "pr.approve.final"]);
    const pr = await makePr(handle.db, staff.id, deptKd, "Phiếu lớn", "PENDING_DIRECTOR");
    await statusJob(pr, "PENDING_DIRECTOR", 3);
    expect(await inbox(director.id)).toHaveLength(1);

    await handle.db
      .update(purchaseRequests)
      .set({ status: "APPROVED" })
      .where(eq(purchaseRequests.id, pr.id));
    await statusJob(pr, "APPROVED", 4);
    expect((await inbox(staff.id)).map((n) => n.type)).toEqual(["pr.approved"]);

    const rejected = await makePr(handle.db, staff.id, deptKd, "Phiếu khác", "REJECTED");
    await handle.db
      .update(purchaseRequests)
      .set({ rejectReason: "Thiếu báo giá thứ hai" })
      .where(eq(purchaseRequests.id, rejected.id));
    await statusJob(rejected, "REJECTED");
    const mine = await inbox(staff.id);
    expect(mine.find((n) => n.type === "pr.rejected")!.body).toContain("Thiếu báo giá thứ hai");
  });

  it("job đến muộn khi phiếu đã sang trạng thái khác: không báo trạng thái cũ", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const manager = await makeUser(handle.db, "tp", deptKd, MANAGER);
    const pr = await makePr(handle.db, staff.id, deptKd, "Phiếu", "CANCELLED");
    expect(await statusJob(pr, "PENDING_MANAGER")).toBe(0);
    expect(await inbox(manager.id)).toHaveLength(0);
  });

  it("người bị thu quyền duyệt trước khi job chạy: không nhận", async () => {
    const staff = await makeUser(handle.db, "nv", deptKd, ["pr.create"]);
    const manager = await makeUser(handle.db, "tp", deptKd, MANAGER);
    const pr = await makePr(handle.db, staff.id, deptKd, "Phiếu", "PENDING_MANAGER");
    await handle.db.delete(rolePermissions).where(eq(rolePermissions.roleId, manager.roleId));
    await statusJob(pr, "PENDING_MANAGER");
    expect(await inbox(manager.id)).toHaveLength(0);
  });
});
