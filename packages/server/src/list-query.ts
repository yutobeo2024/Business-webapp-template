/**
 * Dựng truy vấn danh sách dùng chung (đi cùng `listQuerySchema` trong @app/shared): tìm kiếm, sắp xếp, phân trang.
 * Khuôn: xem các service trong modules/admin (`listUsers` trong users/queries.ts).
 */
import { asc, desc, ilike, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Paginated, SortOrder } from "@app/shared";

/** Escape ký tự đại diện của LIKE: người dùng gõ "50%" là tìm đúng chuỗi "50%", không phải "50 + bất kỳ". */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Điều kiện tìm `q` (không phân biệt hoa thường, chứa chuỗi) trên các cột; không có `q` thì không lọc. */
export function searchCondition(q: string | undefined, columns: AnyPgColumn[]): SQL | undefined {
  if (!q) return undefined;
  const pattern = `%${escapeLike(q)}%`;
  return or(...columns.map((c) => ilike(c, pattern)));
}

/**
 * ORDER BY theo cột người dùng chọn, tra trong bảng cột cho phép (khóa đã được schema giới hạn), kèm khóa phụ duy nhất
 * để thứ tự ổn định giữa các trang (không có khóa phụ, hai dòng cùng giá trị có thể nhảy trang hoặc lặp lại).
 */
export function orderBy<S extends string>(
  sort: S,
  order: SortOrder,
  columns: Record<S, AnyPgColumn | SQL>,
  tiebreaker: AnyPgColumn,
): SQL[] {
  const dir = order === "asc" ? asc : desc;
  return [dir(columns[sort]), dir(tiebreaker)];
}

export function pageOffset(q: { page: number; pageSize: number }): number {
  return (q.page - 1) * q.pageSize;
}

export function paginated<T>(items: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
