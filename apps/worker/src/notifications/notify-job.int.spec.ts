/**
 * Tích hợp lõi thông báo (spec 003), DB thật: job tạo thông báo dùng chung (API đẩy sau commit), loại thông báo lõi,
 * dọn thông báo cũ. Không phụ thuộc module mẫu.
 */
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, notificationDeliveries, notifications, type DbHandle } from "@app/db";
import { notify } from "@app/server";
import { createProcessor, purgeExpired } from "../processors.js";
import { makeUser, resetWorkerDb } from "../testing/fixture.js";
import type { NotificationSender } from "./channel.js";

let handle: DbHandle;
let deptKd: string;
const log = pino({ level: "silent" });
const enqueued: string[] = [];
const fakeEmail: NotificationSender = { send: async () => ({ providerMessageId: "x" }) };

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
});
afterAll(() => handle.close());
beforeEach(async () => {
  ({ deptKd } = await resetWorkerDb(handle.db));
  enqueued.length = 0;
});

const run = () =>
  createProcessor({
    db: handle.db,
    log,
    senders: { email: fakeEmail },
    enqueueDeliveries: async (ids) => {
      enqueued.push(...ids);
    },
  });
const notifyJob = (data: object) =>
  ({ id: "j1", name: "notification.create", data, opts: {}, attemptsMade: 0 }) as never;
const inbox = (userId: string) =>
  handle.db.select().from(notifications).where(eq(notifications.userId, userId));

describe("job tạo thông báo dùng chung", () => {
  it("tạo thông báo trong app + lần giao email, đẩy job giao; chạy lại không tạo thêm", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    const data = {
      type: "account.password_reset",
      userIds: [u.id],
      data: { resetByName: "Quản trị" },
      dedupeKey: "password-reset-1",
    };
    expect(await run()(notifyJob(data))).toBe(1);
    const [n] = await inbox(u.id);
    expect(n).toMatchObject({
      type: "account.password_reset",
      title: "Mật khẩu của bạn đã được đặt lại",
      link: null,
    });
    expect(n!.body).toContain("Quản trị (quản trị viên) đã đặt lại mật khẩu");
    expect(enqueued).toHaveLength(1);
    const [d] = await handle.db.select().from(notificationDeliveries);
    expect(d).toMatchObject({ channel: "email", status: "PENDING", id: enqueued[0] });

    expect(await run()(notifyJob(data))).toBe(0);
    expect(await inbox(u.id)).toHaveLength(1);
  });

  it("kết quả nhập Excel: nội dung theo trạng thái, dẫn về trang của dữ liệu", async () => {
    const u = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    await run()(
      notifyJob({
        type: "import.finished",
        userIds: [u.id],
        data: {
          importId: "8c5f0a52-6f1c-4b6e-9d0a-2f1f5a7f3c11",
          label: "Phòng ban",
          status: "INVALID",
          importedCount: null,
          errorCount: 3,
          returnPath: "/admin/departments",
        },
        dedupeKey: "import-1-INVALID",
      }),
    );
    const [n] = await inbox(u.id);
    expect(n).toMatchObject({ title: "Kết quả kiểm tệp nhập phòng ban", link: "/admin/departments" });
    expect(n!.body).toContain("có 3 lỗi, chưa nhập dòng nào");
  });

  it("loại không có trong danh mục, dữ liệu sai: lỗi vĩnh viễn, không tạo gì", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    await expect(
      run()(notifyJob({ type: "khong.co", userIds: [u.id], data: {}, dedupeKey: "a" })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      run()(notifyJob({ type: "account.password_reset", userIds: [u.id], data: { sai: 1 }, dedupeKey: "b" })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await inbox(u.id)).toHaveLength(0);
  });
});

describe("dọn thông báo cũ", () => {
  it("xóa thông báo đã đọc quá 90 ngày; giữ thông báo chưa đọc dù cũ", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    for (const k of ["doc-cu", "doc-moi", "chua-doc"]) {
      await notify(handle.db, {
        type: "account.password_reset",
        userIds: [u.id],
        data: { resetByName: "Quản trị" },
        dedupeKey: k,
      });
    }
    const old = new Date(Date.now() - 91 * 86_400_000);
    await handle.db.update(notifications).set({ readAt: old }).where(eq(notifications.dedupeKey, "doc-cu"));
    await handle.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.dedupeKey, "doc-moi"));
    await handle.db
      .update(notifications)
      .set({ createdAt: old })
      .where(eq(notifications.dedupeKey, "chua-doc"));
    expect(await purgeExpired({ db: handle.db, log })).toMatchObject({ notifications: 1 });
    expect((await inbox(u.id)).map((n) => n.dedupeKey).sort()).toEqual(["chua-doc", "doc-moi"]);
  });
});
