import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Chạy migration lên DB test trước toàn bộ test tích hợp. Từ chối chạy nếu DB không phải DB test. */
export default function setup(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Test tích hợp cần DATABASE_URL trỏ tới database test");
  const dbName = new URL(url).pathname.replace("/", "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `An toàn: test tích hợp xóa dữ liệu, chỉ chạy trên database có tên kết thúc bằng _test (đang là "${dbName}")`,
    );
  }
  // Redis: test đẩy job thật vào hàng đợi, phải dùng DB index riêng (khác 0) để không lẫn với dev/production.
  const redisUrl = process.env.REDIS_URL;
  const redisDb = redisUrl ? Number(new URL(redisUrl).pathname.replace("/", "") || "0") : 0;
  if (!redisUrl || !(redisDb > 0)) {
    throw new Error(
      "An toàn: test tích hợp cần REDIS_URL trỏ tới Redis DB index riêng, ví dụ redis://localhost:6379/15",
    );
  }
  const migrate = fileURLToPath(new URL("../../../packages/db/dist/migrate.js", import.meta.url));
  execFileSync(process.execPath, [migrate], { stdio: "inherit", env: process.env });
}
