/** Đối tượng tham số (đã qua schema Zod) thành query string; bỏ giá trị rỗng. Mảng thành nhiều tham số cùng tên. */
export function toQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
  }
  return qs.toString();
}
