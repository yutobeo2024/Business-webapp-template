/**
 * Khôi phục quyền quản trị khi không còn ai quản trị được (spec 000 BR-A5). Chạy trên máy chủ:
 *   infra/dc.sh --profile tools run --rm migrate node dist/cli/grant-admin.js <email>
 * Dev: pnpm --filter @app/api run grant-admin -- <email>
 */
import { createDb } from "@app/db";
import { grantAdmin } from "../auth/grant-admin.js";

const url = process.env.DATABASE_URL;
const email = process.argv[2];
if (!url || !email) {
  console.error("Dùng: grant-admin <email> (cần DATABASE_URL)");
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1, appName: "grant-admin" });
try {
  await grantAdmin(db, email);
  console.warn(`[grant-admin] ${email}: đã kích hoạt và gán vai trò Quản trị hệ thống`);
} catch (err) {
  console.error(`[grant-admin] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await close();
}
