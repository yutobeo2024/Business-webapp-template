import { z } from "zod";
import { PR_STATUSES } from "./purchase-request.js"; // sample

export const QUEUES = {
  notifications: "notifications",
  /** Hàng đợi riêng, ít luồng: xuất file tốn RAM/CPU (Chromium), không được làm chậm thông báo. */
  exports: "exports",
  /** Nhập Excel: kiểm và ghi dữ liệu, chạy lần lượt. */
  imports: "imports",
} as const;

export const JOBS = {
  prStatusChanged: "pr.status_changed", // sample
  exportRun: "export.run",
  notificationDeliver: "notification.deliver",
  /** Tạo thông báo (trong app + kênh ngoài) từ bất kỳ đâu: API đẩy job này sau commit, worker gọi notify. */
  notify: "notification.create",
  importValidate: "import.validate",
  importCommit: "import.commit",
} as const;

export const importJobSchema = z.object({ importId: z.uuid() });
export type ImportJobPayload = z.infer<typeof importJobSchema>;

export const exportRunJobSchema = z.object({ exportId: z.uuid() });
export type ExportRunJob = z.infer<typeof exportRunJobSchema>;

export const notificationDeliverJobSchema = z.object({ deliveryId: z.uuid() });

/** Payload job tạo thông báo; `type`/`data` được worker kiểm lại bằng NOTIFICATION_DATA_SCHEMAS. */
export const notifyJobSchema = z.object({
  type: z.string().min(1),
  userIds: z.array(z.uuid()).min(1).max(1000),
  data: z.unknown(),
  dedupeKey: z.string().min(1).max(200),
});
export type NotifyJob = z.infer<typeof notifyJobSchema>;
export type NotificationDeliverJob = z.infer<typeof notificationDeliverJobSchema>;

// sample:begin
/** Payload job cũng là input ở biên (quy ước #2): API tạo theo type này, worker validate bằng schema trước khi xử lý. */
export const prStatusChangedJobSchema = z.object({
  purchaseRequestId: z.uuid(),
  code: z.string().min(1),
  from: z.enum(PR_STATUSES),
  to: z.enum(PR_STATUSES),
  actorId: z.uuid(),
  version: z.number().int().min(1),
});
export type PrStatusChangedJob = z.infer<typeof prStatusChangedJobSchema>;
// sample:end
