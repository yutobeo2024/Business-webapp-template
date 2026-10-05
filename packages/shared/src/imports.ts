/**
 * Danh mục loại nhập Excel (spec 003). Nhập hai bước: tải lên -> worker kiểm từng dòng -> người dùng xem lỗi/xem trước ->
 * xác nhận -> worker kiểm lại và ghi TẤT CẢ trong một transaction (có lỗi thì không ghi gì).
 * Thêm loại nhập: một mục trong IMPORT_TYPES + schema dòng trong IMPORT_ROW_SCHEMAS, rồi định nghĩa kiểm/ghi trong
 * `packages/server/src/imports/definitions.ts` (typecheck đỏ nếu quên).
 */
import { z } from "zod";
import { createDepartmentSchema } from "./admin.js";
import type { Permission } from "./permissions.js";

export const IMPORT_STATUSES = [
  "VALIDATING",
  "READY",
  "INVALID",
  "COMMITTING",
  "DONE",
  "FAILED",
  "CANCELLED",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  VALIDATING: "Đang kiểm tra",
  READY: "Sẵn sàng nhập",
  INVALID: "Có lỗi",
  COMMITTING: "Đang nhập",
  DONE: "Đã nhập",
  FAILED: "Lỗi hệ thống",
  CANCELLED: "Đã hủy",
};

export interface ImportColumn {
  /** Trường trong schema dòng. */
  key: string;
  /** Tiêu đề cột trong tệp Excel (khớp không phân biệt hoa thường, thứ tự cột tùy ý). */
  header: string;
  example: string;
  required: boolean;
}

/** Schema cho MỘT dòng của từng loại: dùng lại schema của form tạo tương ứng để nhập và nhập tay có cùng quy tắc. */
export const IMPORT_ROW_SCHEMAS = {
  departments: createDepartmentSchema,
};
export type ImportType = keyof typeof IMPORT_ROW_SCHEMAS;
export const IMPORT_TYPE_KEYS = Object.keys(IMPORT_ROW_SCHEMAS) as ImportType[];
export const importTypeSchema = z.enum(
  IMPORT_TYPE_KEYS as [ImportType, ...ImportType[]],
  "Loại nhập không hợp lệ",
);

export const IMPORT_TYPES = {
  departments: {
    label: "Phòng ban",
    permission: "departments.manage",
    returnPath: "/admin/departments",
    columns: [
      { key: "code", header: "Mã phòng ban", example: "KD", required: true },
      { key: "name", header: "Tên phòng ban", example: "Phòng Kinh doanh", required: true },
    ],
  },
} as const satisfies Record<
  ImportType,
  {
    label: string;
    permission: Permission;
    /** Trang của dữ liệu được nhập: thông báo kết quả dẫn về đây. */
    returnPath: string;
    columns: readonly ImportColumn[];
  }
>;

/** Số dòng dữ liệu tối đa mỗi tệp (không tính dòng tiêu đề). */
export const IMPORT_MAX_ROWS = 5000;
/** Số lỗi tối đa lưu và trả về (đủ để sửa; tệp sai hàng loạt thì sửa theo mẫu đầu tiên). */
export const IMPORT_MAX_ERRORS = 500;
/** Số dòng hợp lệ hiển thị xem trước. */
export const IMPORT_PREVIEW_ROWS = 20;

export interface ImportRowError {
  /** Số dòng trong Excel (dòng tiêu đề là 1); null: lỗi cả tệp. */
  row: number | null;
  /** Tiêu đề cột; null: lỗi cả dòng. */
  column: string | null;
  message: string;
}

export interface ImportJobDto {
  id: string;
  type: ImportType;
  label: string;
  status: ImportStatus;
  fileName: string | null;
  totalRows: number | null;
  errorCount: number;
  errors: ImportRowError[];
  /** Vài dòng hợp lệ đầu tiên, khóa theo tiêu đề cột. */
  preview: Record<string, string>[];
  importedCount: number | null;
  createdAt: string;
  finishedAt: string | null;
}
