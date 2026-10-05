/**
 * Gửi một lần giao (notification_deliveries) qua kênh của nó (spec 003). Không gửi hai lần song song: job "giành" hàng
 * PENDING -> SENDING trước khi gửi. Worker chết đúng lúc đang gửi thì lượt quét sau 10 phút có thể gửi lại một lần
 * (ít nhất một lần, ghi trong ADR-0006).
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { notificationDeliveries, notifications, users, type Db } from "@app/db";
import type { NotificationChannel, NotificationData, NotificationType } from "@app/shared";
import { type NotificationSender, PermanentDeliveryError } from "./channel.js";

export interface DeliverDeps {
  db: Db;
  log: Logger;
  senders: Partial<Record<NotificationChannel, NotificationSender>>;
}

/** Số lần thử tối đa cho một lần giao (khớp `attempts` của job). */
export const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_MS = 10 * 60 * 1000;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

export type DeliverOutcome = "sent" | "failed" | "skipped" | "retry";

export async function deliver(
  deps: DeliverDeps,
  deliveryId: string,
  opts: { finalAttempt: boolean } = { finalAttempt: true },
): Promise<DeliverOutcome> {
  const { db } = deps;
  const [claimed] = await db
    .update(notificationDeliveries)
    .set({ status: "SENDING", attempts: sql`${notificationDeliveries.attempts} + 1` })
    .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, "PENDING")))
    .returning();
  if (!claimed) return "skipped"; // đã gửi, đã bỏ qua, hoặc job khác đang gửi

  const finish = (
    status: "SENT" | "FAILED" | "SKIPPED" | "PENDING",
    patch: { error?: string | null; sentAt?: Date; providerMessageId?: string | null } = {},
  ) =>
    db
      .update(notificationDeliveries)
      .set({ status, ...patch })
      .where(eq(notificationDeliveries.id, deliveryId));

  const [row] = await db
    .select({ n: notifications, user: users })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, claimed.notificationId));
  if (!row?.user.isActive) {
    await finish("SKIPPED", { error: "Tài khoản đã khóa" });
    return "skipped";
  }
  const sender = deps.senders[claimed.channel];
  if (!sender) {
    await finish("SKIPPED", { error: "Kênh chưa được cấu hình" });
    return "skipped";
  }

  try {
    const res = await sender.send(
      { fullName: row.user.fullName, email: row.user.email, phone: row.user.phone },
      {
        type: row.n.type as NotificationType,
        title: row.n.title,
        body: row.n.body,
        link: row.n.link,
        data: row.n.data as NotificationData<NotificationType>,
        trackingId: deliveryId,
      },
    );
    await finish("SENT", { sentAt: new Date(), providerMessageId: res.providerMessageId, error: null });
    return "sent";
  } catch (err) {
    const permanent = err instanceof PermanentDeliveryError;
    deps.log.warn(
      { deliveryId, channel: claimed.channel, permanent, err: errorText(err) },
      "Gửi thông báo lỗi",
    );
    if (permanent || opts.finalAttempt || claimed.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await finish("FAILED", { error: errorText(err) });
      return "failed";
    }
    await finish("PENDING", { error: errorText(err) });
    return "retry";
  }
}

/**
 * Chạy mỗi 10 phút: lần giao kẹt ở SENDING (worker chết giữa chừng) trả về PENDING; quá số lần thử thì FAILED; PENDING
 * lâu không ai gửi (đẩy job lỗi sau commit, job mất) thì trả danh sách để đẩy job lại.
 */
export async function sweepDeliveries(
  deps: Pick<DeliverDeps, "db" | "log">,
  now = new Date(),
): Promise<string[]> {
  const { db } = deps;
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const interrupted = await db
    .update(notificationDeliveries)
    .set({ status: "PENDING", error: "Gửi bị gián đoạn, thử lại" })
    .where(
      and(eq(notificationDeliveries.status, "SENDING"), lt(notificationDeliveries.updatedAt, staleBefore)),
    )
    .returning({ id: notificationDeliveries.id });
  const exhausted = await db
    .update(notificationDeliveries)
    .set({ status: "FAILED", error: "Quá số lần thử" })
    .where(
      and(
        eq(notificationDeliveries.status, "PENDING"),
        sql`${notificationDeliveries.attempts} >= ${MAX_DELIVERY_ATTEMPTS}`,
      ),
    )
    .returning({ id: notificationDeliveries.id });
  const stale = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.status, "PENDING"), lt(notificationDeliveries.updatedAt, staleBefore)),
    )
    .limit(1000);
  // Hàng vừa gỡ khỏi SENDING không còn job nào giữ: đẩy lại ngay trong lượt này (trừ hàng đã hết lượt thử).
  const failed = new Set(exhausted.map((e) => e.id));
  const requeue = [...new Set([...interrupted.map((r) => r.id), ...stale.map((s) => s.id)])].filter(
    (id) => !failed.has(id),
  );
  if (requeue.length || exhausted.length) {
    deps.log.info({ requeue: requeue.length, failed: exhausted.length }, "Quét lại lần giao thông báo");
  }
  return requeue;
}
