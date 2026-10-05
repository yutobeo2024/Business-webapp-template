/**
 * Kênh gửi thông báo ra ngoài (spec 003). Thêm kênh (SMS, Teams...): implement NotificationSender, đăng ký trong
 * main.ts, thêm vào NOTIFICATION_CHANNELS. Kênh KHÔNG tự thử lại: lỗi tạm thời thì ném lỗi thường (BullMQ thử lại),
 * lỗi chắc chắn không gửi được thì ném PermanentDeliveryError (không thử lại).
 */
import type { NotificationData, NotificationType } from "@app/shared";

export interface OutgoingNotification {
  type: NotificationType;
  title: string;
  body: string;
  /** Đường dẫn trong app ("/..."), kênh tự ghép với APP_ORIGIN. */
  link: string | null;
  data: NotificationData<NotificationType>;
  /** Id lần giao: gửi kèm nhà cung cấp (tracking_id) để đối soát. */
  trackingId: string;
}

export interface Recipient {
  fullName: string;
  email: string;
  /** 84xxxxxxxxx */
  phone: string | null;
}

export interface NotificationSender {
  send(to: Recipient, n: OutgoingNotification): Promise<{ providerMessageId: string | null }>;
}

/** Không bao giờ gửi được nếu thử lại (địa chỉ sai, mẫu sai, số không dùng Zalo...). */
export class PermanentDeliveryError extends Error {}
