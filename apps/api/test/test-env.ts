import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/**
 * Môi trường cho test tích hợp chạy cục bộ: lấy DB/Redis TEST của dự án từ `.env` (TEST_DATABASE_URL, TEST_REDIS_URL),
 * không phải DB dev. Biến đã đặt sẵn (CI đặt DATABASE_URL, REDIS_URL) thì giữ nguyên.
 */
export function useTestEnv(): void {
  const file = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (!existsSync(file)) return;
  const env = parseEnv(readFileSync(file, "utf8"));
  if (!process.env.DATABASE_URL && env.TEST_DATABASE_URL) process.env.DATABASE_URL = env.TEST_DATABASE_URL;
  if (!process.env.REDIS_URL && env.TEST_REDIS_URL) process.env.REDIS_URL = env.TEST_REDIS_URL;
}
