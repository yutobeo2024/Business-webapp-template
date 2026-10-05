/**
 * Danh mục loại xuất file (spec 002). Mọi lần xuất chạy nền trong worker: API chỉ kiểm quyền và xếp hàng, người dùng tải
 * về khi xong. Thêm loại xuất: thêm một phần tử vào `createExportSchema` + `EXPORT_TYPES`, rồi một runner trong worker
 * (`apps/worker/src/exports/runners.ts`, typecheck đỏ nếu quên).
 */
import { z } from "zod";
import type { Permission } from "./permissions.js";
import { listUsersQuerySchema } from "./admin.js";
import { listPurchaseRequestsQuerySchema } from "./purchase-request.js"; // sample

export const EXPORT_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  QUEUED: "Đang chờ",
  RUNNING: "Đang tạo",
  DONE: "Xong",
  FAILED: "Lỗi",
};

/** Mỗi loại: tham số validate bằng Zod (input ở biên), dùng lại schema của màn hình gốc để xuất đúng thứ đang lọc. */
export const createExportSchema = z.discriminatedUnion("type", [
  // Lõi: danh sách người dùng (quản trị), đúng bộ lọc đang xem.
  z.object({
    type: z.literal("admin.users.xlsx"),
    params: listUsersQuerySchema.omit({ page: true, pageSize: true }),
  }),
  // sample:begin
  z.object({
    type: z.literal("purchase-requests.xlsx"),
    params: listPurchaseRequestsQuerySchema.omit({ page: true, pageSize: true }),
  }),
  z.object({
    type: z.literal("purchase-request.pdf"),
    params: z.object({ id: z.uuid("Mã phiếu không hợp lệ") }),
  }),
  // sample:end
]);
export type CreateExportInput = z.infer<typeof createExportSchema>;
export type ExportType = CreateExportInput["type"];
export type ExportParams<T extends ExportType> = Extract<CreateExportInput, { type: T }>["params"];

export interface ExportTypeDef {
  label: string;
  format: "xlsx" | "pdf";
  /**
   * Quyền phải có để xuất (kiểm lúc yêu cầu VÀ lúc worker chạy). null: chỉ cần xem được dữ liệu, ví dụ in một phiếu mình
   * xem được. Dữ liệu xuất luôn đi qua đúng truy vấn và phạm vi xem của màn hình gốc.
   */
  permission: Permission | null;
}

export const EXPORT_TYPES = {
  "admin.users.xlsx": { label: "Danh sách người dùng (Excel)", format: "xlsx", permission: "users.manage" },
  // sample:begin
  "purchase-requests.xlsx": {
    label: "Danh sách phiếu đề nghị (Excel)",
    format: "xlsx",
    permission: "pr.export",
  },
  "purchase-request.pdf": { label: "Phiếu đề nghị (PDF)", format: "pdf", permission: null },
  // sample:end
} as const satisfies Record<ExportType, ExportTypeDef>;

export interface ExportJobDto {
  id: string;
  type: ExportType;
  label: string;
  status: ExportStatus;
  rowCount: number | null;
  /** Câu báo lỗi cho người dùng khi FAILED (không chứa chi tiết nội bộ). */
  error: string | null;
  fileName: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  /** DONE và chưa hết hạn. */
  downloadable: boolean;
}

/** Số lần xuất đang chờ/đang chạy tối đa của một người (chống bấm liên tục làm nghẽn worker). */
export const EXPORT_MAX_ACTIVE_PER_USER = 3;
