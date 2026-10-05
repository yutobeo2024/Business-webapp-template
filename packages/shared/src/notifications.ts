/**
 * Danh mục thông báo (spec 003). Thông báo trong app luôn có; email và Zalo là kênh thêm, mỗi người tự bật/tắt.
 * Thêm loại thông báo: thêm một mục vào NOTIFICATION_TYPES + schema dữ liệu, rồi mẫu nội dung trong
 * `packages/server/src/notifications/templates.ts` (typecheck đỏ nếu quên) và nơi gọi `notify` trong worker.
 */
import { z } from "zod";
import { paginationQuerySchema } from "./api.js";

/** Kênh gửi ra ngoài. Trong app không nằm ở đây vì luôn bật. */
export const NOTIFICATION_CHANNELS = ["email", "zalo"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  zalo: "Zalo",
};

export const DELIVERY_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Số di động Việt Nam, chấp nhận "0912 345 678", "+84 912.345.678", "84912345678"; lưu dạng "84912345678" (định dạng
 * Zalo ZNS cần). Chỉ đầu số di động (3, 5, 7, 8, 9).
 */
export const vnPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.\-()]/g, ""))
  .transform((v) => (v.startsWith("+84") ? v.slice(1) : v.startsWith("0") ? `84${v.slice(1)}` : v))
  .refine((v) => /^84[35789]\d{8}$/.test(v), "Số điện thoại di động không hợp lệ (ví dụ 0912 345 678)");

/** Ô số điện thoại trên form: để trống = không có. */
export const optionalPhoneSchema = z
  .union([z.literal(""), z.null(), vnPhoneSchema])
  .transform((v) => (v ? v : null));

/** "84912345678" -> "0912 345 678" để hiển thị. */
export const formatPhone = (phone: string): string =>
  phone.startsWith("84") && phone.length === 11
    ? `0${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`
    : phone;

export interface NotificationSettingDto {
  channel: NotificationChannel;
  enabled: boolean;
  /** Kênh dùng được không: hệ thống đã cấu hình kênh và tài khoản có địa chỉ (email, SĐT). */
  available: boolean;
  /** Vì sao không dùng được, để hiện cho người dùng. */
  unavailableReason: string | null;
}

export const updateNotificationSettingsSchema = z.object({
  email: z.boolean(),
  zalo: z.boolean(),
}) satisfies z.ZodType<Record<NotificationChannel, boolean>>;
export type UpdateNotificationSettingsInput = z.infer<typeof updateNotificationSettingsSchema>;

// sample:begin (phiếu đề nghị mẫu)
const prRef = {
  prId: z.uuid(),
  code: z.string().min(1),
  title: z.string(),
  totalAmount: z.number().int(),
  requesterName: z.string(),
};

// sample:end

/** Dữ liệu của từng loại: chỉ chứa thứ người nhận được xem (worker đã kiểm phạm vi xem trước khi gửi). */
export const NOTIFICATION_DATA_SCHEMAS = {
  // Lõi: báo người dùng khi quản trị viên đặt lại mật khẩu (cảnh báo an ninh, nhất là qua email).
  "account.password_reset": z.object({ resetByName: z.string() }),
  // Lõi: kết quả nhập Excel (người nhập có thể đã đóng hộp thoại).
  "import.finished": z.object({
    importId: z.uuid(),
    label: z.string(),
    status: z.enum(["READY", "DONE", "INVALID", "FAILED"]),
    importedCount: z.number().int().nullable(),
    errorCount: z.number().int(),
    returnPath: z.string().nullable(),
  }),
  // sample:begin
  "pr.pending_approval": z.object(prRef),
  "pr.approved": z.object(prRef),
  "pr.rejected": z.object({ ...prRef, reason: z.string() }),
  // sample:end
};
export type NotificationType = keyof typeof NOTIFICATION_DATA_SCHEMAS;
export type NotificationData<T extends NotificationType> = z.infer<(typeof NOTIFICATION_DATA_SCHEMAS)[T]>;

export const NOTIFICATION_TYPES = {
  "account.password_reset": { label: "Mật khẩu của bạn được quản trị viên đặt lại" },
  "import.finished": { label: "Kết quả nhập dữ liệu từ Excel" },
  // sample:begin
  "pr.pending_approval": { label: "Phiếu đề nghị chờ bạn duyệt" },
  "pr.approved": { label: "Phiếu đề nghị của bạn đã được duyệt" },
  "pr.rejected": { label: "Phiếu đề nghị của bạn bị từ chối" },
  // sample:end
} as const satisfies Record<NotificationType, { label: string }>;

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Đường dẫn trong app (bắt đầu bằng "/"), null nếu không có trang đích. */
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
