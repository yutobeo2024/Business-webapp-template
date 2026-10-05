// Áp dụng migration. Chạy được ở dev (`pnpm db:migrate`) và production (service `migrate` trong compose).
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu DATABASE_URL");
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
// Không giới hạn thời gian câu lệnh: thêm cột có default, backfill trên bảng lớn có thể chạy quá 30 giây.
// Nhưng giới hạn thời gian CHỜ KHÓA: ALTER TABLE xếp sau một transaction dài sẽ chặn mọi query vào bảng đó;
// quá 15 giây thì migration lỗi, deploy tự quay về bản trước thay vì làm app đứng.
const handle = createDb(url, { max: 1, appName: "migrate", statementTimeoutMs: 0, lockTimeoutMs: 15_000 });

try {
  await migrate(handle.db, { migrationsFolder });
  console.warn(`[migrate] OK (${migrationsFolder})`);
} catch (err) {
  console.error("[migrate] FAIL", err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
