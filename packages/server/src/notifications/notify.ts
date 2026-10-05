/**
 * Tạo thông báo cho danh sách người nhận (spec 003). Gọi từ worker sau khi đã tính người nhận theo quyền HIỆN TẠI.
 * Idempotent: (người nhận, dedupeKey) là duy nhất, job chạy lại không tạo thông báo thứ hai, cũng không tạo lần giao
 * thứ hai. Kênh ngoài (email, Zalo) được ghi thành `notification_deliveries`; nơi gọi đẩy job gửi cho các hàng PENDING
 * SAU khi transaction commit.
 */
import { and, eq, inArray } from "drizzle-orm";
import { notificationDeliveries, notifications, userNotificationSettings, users, type DbOrTx } from "@app/db";
import {
  NOTIFICATION_DATA_SCHEMAS,
  type NotificationChannel,
  type NotificationData,
  type NotificationType,
} from "@app/shared";
import { renderNotification } from "./templates.js";

export interface NotifyInput<T extends NotificationType> {
  type: T;
  userIds: readonly string[];
  data: NotificationData<T>;
  /** Định danh sự kiện, ví dụ `pr-<id>-v<version>`: cùng sự kiện thì không báo lần hai. */
  dedupeKey: string;
}

export interface NotifyOptions {
  /** Kênh ngoài hệ thống đang cấu hình (worker biết từ env). Trống: chỉ thông báo trong app. */
  channels?: readonly NotificationChannel[];
}

export interface NotifyResult {
  /** Thông báo VỪA tạo (người đã được báo cho sự kiện này bị bỏ qua). */
  notificationIds: string[];
  /** Lần giao cần gửi: nơi gọi đẩy job `notification.deliver` cho từng id sau commit. */
  pendingDeliveryIds: string[];
}

export async function notify<T extends NotificationType>(
  db: DbOrTx,
  input: NotifyInput<T>,
  opts: NotifyOptions = {},
): Promise<NotifyResult> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return { notificationIds: [], pendingDeliveryIds: [] };
  // Dữ liệu là input ở biên (đi qua job): kiểm lại trước khi dựng nội dung.
  const data = NOTIFICATION_DATA_SCHEMAS[input.type].parse(input.data) as NotificationData<T>;
  const content = renderNotification(input.type, data);
  const channels = opts.channels ?? [];

  return db.transaction(async (tx) => {
    const created = await tx
      .insert(notifications)
      .values(
        userIds.map((userId) => ({ userId, type: input.type, data, dedupeKey: input.dedupeKey, ...content })),
      )
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({ id: notifications.id, userId: notifications.userId });
    if (created.length === 0 || channels.length === 0) {
      return { notificationIds: created.map((c) => c.id), pendingDeliveryIds: [] };
    }

    const recipients = await tx
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(
        inArray(
          users.id,
          created.map((c) => c.userId),
        ),
      );
    const phoneOf = new Map(recipients.map((r) => [r.id, r.phone]));
    const off = await tx
      .select({ userId: userNotificationSettings.userId, channel: userNotificationSettings.channel })
      .from(userNotificationSettings)
      .where(
        and(
          inArray(
            userNotificationSettings.userId,
            created.map((c) => c.userId),
          ),
          eq(userNotificationSettings.enabled, false),
        ),
      );
    const isOff = new Set(off.map((o) => `${o.userId}:${o.channel}`));

    const rows = created.flatMap((n) =>
      channels.map((channel) => {
        const skip = isOff.has(`${n.userId}:${channel}`)
          ? "Người nhận đã tắt kênh này"
          : channel === "zalo" && !phoneOf.get(n.userId)
            ? "Tài khoản chưa có số điện thoại"
            : null;
        return {
          notificationId: n.id,
          channel,
          status: skip ? ("SKIPPED" as const) : ("PENDING" as const),
          error: skip,
        };
      }),
    );
    const deliveries = await tx
      .insert(notificationDeliveries)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id, status: notificationDeliveries.status });
    return {
      notificationIds: created.map((c) => c.id),
      pendingDeliveryIds: deliveries.filter((d) => d.status === "PENDING").map((d) => d.id),
    };
  });
}
