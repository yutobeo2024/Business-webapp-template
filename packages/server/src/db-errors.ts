/** Lỗi vi phạm ràng buộc UNIQUE của PostgreSQL (23505). Drizzle bọc lỗi của pg trong `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
