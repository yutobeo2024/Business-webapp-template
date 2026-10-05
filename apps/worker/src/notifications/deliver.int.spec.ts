/**
 * Tích hợp gửi thông báo qua kênh ngoài (spec 003): DB thật + Mailpit (SMTP giả có API đọc thư).
 * Mailpit: `pnpm dev:services` (dev) hoặc service trong CI. Địa chỉ: TEST_SMTP_URL, TEST_MAILPIT_URL.
 */
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, notificationDeliveries, userNotificationSettings, users, type DbHandle } from "@app/db";
import { notify } from "@app/server";
import { makeUser, resetWorkerDb } from "../testing/fixture.js";
import { type NotificationSender, PermanentDeliveryError } from "./channel.js";
import { deliver, type DeliverDeps, sweepDeliveries } from "./deliver.js";
import { EmailSender } from "./email.js";

const SMTP_URL = process.env.TEST_SMTP_URL ?? "smtp://localhost:1025";
const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";

let handle: DbHandle;
let email: EmailSender;
let deptKd: string;
const log = pino({ level: "silent" });

interface MailpitMessage {
  Subject: string;
  To: { Address: string; Name: string }[];
}
async function inbox(address: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
  email = new EmailSender(SMTP_URL, "Hệ thống <no-reply@app.test>", "https://app.test");
});
afterAll(async () => {
  email.close();
  await handle.close();
});
beforeEach(async () => {
  ({ deptKd } = await resetWorkerDb(handle.db));
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
});

const data = { resetByName: "Quản trị" };
const deps = (senders: DeliverDeps["senders"]): DeliverDeps => ({ db: handle.db, log, senders });
const statusOf = async (id: string) =>
  (await handle.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)))[0]!;
const notifyOne = (userId: string, dedupeKey: string, channels: ("email" | "zalo")[]) =>
  notify(handle.db, { type: "account.password_reset", userIds: [userId], data, dedupeKey }, { channels });

describe("giao thông báo qua email và Zalo", () => {
  it("email tới hộp thư người nhận đúng tiêu đề; chạy lại không gửi lần hai", async () => {
    const u = await makeUser(handle.db, "tp", deptKd, []);
    const r = await notifyOne(u.id, "k1", ["email"]);
    expect(r.pendingDeliveryIds).toHaveLength(1);
    const id = r.pendingDeliveryIds[0]!;
    expect(await deliver(deps({ email }), id)).toBe("sent");
    expect(await deliver(deps({ email }), id)).toBe("skipped");
    const mails = await inbox("tp@test.vn");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.Subject).toBe("Mật khẩu của bạn đã được đặt lại");
    expect((await statusOf(id)).status).toBe("SENT");

    // notify chạy lại cho cùng sự kiện: không tạo thông báo hay lần giao mới.
    expect(await notifyOne(u.id, "k1", ["email"])).toEqual({ notificationIds: [], pendingDeliveryIds: [] });
  });

  it("người dùng tắt kênh, chưa có SĐT cho Zalo: SKIPPED kèm lý do, không gửi", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    await handle.db
      .insert(userNotificationSettings)
      .values({ userId: u.id, channel: "email", enabled: false });
    const r = await notifyOne(u.id, "k2", ["email", "zalo"]);
    expect(r.pendingDeliveryIds).toHaveLength(0);
    const rows = await handle.db.select().from(notificationDeliveries);
    expect(rows.map((d) => [d.channel, d.status, d.error]).sort()).toEqual([
      ["email", "SKIPPED", "Người nhận đã tắt kênh này"],
      ["zalo", "SKIPPED", "Tài khoản chưa có số điện thoại"],
    ]);
  });

  it("tài khoản bị khóa trước lúc gửi: SKIPPED, không có thư", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    const r = await notifyOne(u.id, "k3", ["email"]);
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
    expect(await deliver(deps({ email }), r.pendingDeliveryIds[0]!)).toBe("skipped");
    expect(await inbox("nv@test.vn")).toHaveLength(0);
  });

  it("lỗi tạm thời: chờ thử lại (PENDING), lần cuối thì FAILED; lỗi vĩnh viễn: FAILED ngay", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    const flaky: NotificationSender = { send: () => Promise.reject(new Error("ECONNRESET")) };
    const broken: NotificationSender = {
      send: () => Promise.reject(new PermanentDeliveryError("550 mailbox not found")),
    };
    const id = (await notifyOne(u.id, "k4", ["email"])).pendingDeliveryIds[0]!;
    expect(await deliver(deps({ email: flaky }), id, { finalAttempt: false })).toBe("retry");
    expect(await statusOf(id)).toMatchObject({ status: "PENDING", attempts: 1, error: "ECONNRESET" });
    expect(await deliver(deps({ email: flaky }), id, { finalAttempt: true })).toBe("failed");
    expect((await statusOf(id)).status).toBe("FAILED");

    const id2 = (await notifyOne(u.id, "k5", ["email"])).pendingDeliveryIds[0]!;
    expect(await deliver(deps({ email: broken }), id2, { finalAttempt: false })).toBe("failed");
  });

  it("quét lại: lần giao kẹt ở SENDING quá 10 phút được đẩy lại và gửi được; hết lượt thử thì FAILED", async () => {
    const u = await makeUser(handle.db, "nv", deptKd, []);
    const id = (await notifyOne(u.id, "k6", ["email"])).pendingDeliveryIds[0]!;
    await handle.db
      .update(notificationDeliveries)
      .set({ status: "SENDING" })
      .where(eq(notificationDeliveries.id, id));
    const later = new Date(Date.now() + 11 * 60 * 1000);
    expect(await sweepDeliveries({ db: handle.db, log }, later)).toEqual([id]);
    expect((await statusOf(id)).status).toBe("PENDING");
    expect(await deliver(deps({ email }), id)).toBe("sent");

    // PENDING đã quá số lần thử: FAILED, không đẩy lại.
    const id2 = (await notifyOne(u.id, "k7", ["email"])).pendingDeliveryIds[0]!;
    await handle.db
      .update(notificationDeliveries)
      .set({ attempts: 5 })
      .where(eq(notificationDeliveries.id, id2));
    expect(await sweepDeliveries({ db: handle.db, log }, later)).toEqual([]);
    expect((await statusOf(id2)).status).toBe("FAILED");
  });
});
