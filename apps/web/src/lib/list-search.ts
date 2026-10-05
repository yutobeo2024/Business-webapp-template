import type { z } from "zod";

/**
 * Tham số danh sách nằm trên URL (tải lại trang, gửi link vẫn giữ bộ lọc). Route dùng chính schema Zod ở shared:
 *   validateSearch: searchValidator(listUsersQuerySchema)
 * URL sai (sửa tay, link cũ) thì về mặc định thay vì lỗi trang.
 */
export function searchValidator<S extends z.ZodType>(schema: S) {
  return (raw: Record<string, unknown>): z.output<S> => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : schema.parse({});
  };
}

/**
 * Tham số mới khi người dùng đổi bộ lọc: đổi bất kỳ thứ gì trừ trang thì quay về trang 1 (trang 5 của bộ lọc cũ có thể
 * không tồn tại ở bộ lọc mới); giá trị rỗng bị bỏ khỏi URL.
 */
export function nextSearch<T extends { page: number }>(prev: T, patch: Partial<T>): T {
  const merged: Record<string, unknown> = { ...prev, ...patch };
  if (!("page" in patch)) merged.page = 1;
  for (const [k, v] of Object.entries(merged)) if (v === "" || v === undefined) delete merged[k];
  return merged as T;
}
