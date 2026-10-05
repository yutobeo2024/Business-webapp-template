import { z } from "zod";

/** Định dạng lỗi thống nhất mà API trả về. `message` là tiếng Việt, hiển thị được cho người dùng. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * Tham số danh sách dùng chung: phân trang + tìm kiếm `q` + sắp xếp theo cột CHO PHÉP (cột khác: 400, không bao giờ
 * ghép tên cột từ input vào SQL). Bộ lọc riêng của module thêm bằng `.extend({...})`.
 * Cùng một schema dùng ở API (ZodPipe) và ở web (đọc tham số trên URL), nên hai bên luôn khớp.
 */
export function listQuerySchema<const S extends readonly [string, ...string[]]>(opts: {
  sortable: S;
  defaultSort: S[number];
  defaultOrder?: SortOrder;
}) {
  return paginationQuerySchema.extend({
    q: z
      .string()
      .trim()
      .max(100, "Từ khóa tối đa 100 ký tự")
      .transform((v) => v || undefined)
      .optional(),
    sort: z.enum(opts.sortable, "Không sắp xếp được theo cột này").default(opts.defaultSort),
    order: z.enum(SORT_ORDERS).default(opts.defaultOrder ?? "desc"),
  });
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
