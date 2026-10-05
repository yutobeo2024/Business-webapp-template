// Dựng lại DB CỤC BỘ của dự án từ đầu (xóa nếu có, tạo lại, chạy migration; DB dev thì seed thêm --demo).
//   pnpm db:reset-local          -> DB test (TEST_DATABASE_URL trong .env, tên phải kết thúc bằng _test)
//   pnpm db:reset-local dev      -> DB dev  (DATABASE_URL trong .env; mất dữ liệu dev)
// Dùng khi: lần đầu cài (tạo DB riêng của dự án), migration CHƯA commit đã áp vào DB cục bộ rồi phải sinh lại (skill
// /db-migration), DB test bẩn, hoặc E2E cần dữ liệu demo mới.
// Chỉ chạy trên Postgres của `pnpm dev:services` (docker compose infra/compose.dev.yml), không bao giờ đụng máy chủ.
// Cần build trước (`pnpm build`): chạy migrate/seed từ dist.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "test";
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
if (!["test", "dev"].includes(target)) fail("Dùng: pnpm db:reset-local [test|dev]");
if (process.env.NODE_ENV === "production") fail("DỪNG: NODE_ENV=production. Lệnh này chỉ cho DB cục bộ.");

const envFile = join(root, ".env");
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const url = target === "test" ? env.TEST_DATABASE_URL : env.DATABASE_URL;
if (!url)
  fail(`Thiếu ${target === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL"} trong .env (xem .env.example).`);
const parsed = new URL(url);
const db = decodeURIComponent(parsed.pathname.slice(1));
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) fail(`DỪNG: ${url} không phải DB cục bộ.`);
if (!/^[a-z][a-z0-9_]{0,62}$/.test(db)) fail(`Tên DB không hợp lệ: "${db}" (chữ thường, số, _).`);
if (target === "test" && !db.endsWith("_test"))
  fail(`DB test phải có tên kết thúc bằng _test (đang là "${db}").`);
for (const f of ["packages/db/dist/migrate.js", "apps/api/dist/cli/seed.js"]) {
  if (!existsSync(join(root, f))) fail(`Chưa build (${f}). Chạy: pnpm build`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Tên DB đã kiểm bằng regex ở trên nên ghép vào SQL được.
run("docker", [
  "compose",
  "-f",
  "infra/compose.dev.yml",
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  "app",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-c",
  `drop database if exists ${db} with (force)`,
  "-c",
  `create database ${db}`,
]);
// Biến đặt sẵn thắng .env (--env-file-if-exists không ghi đè): luôn trỏ đúng DB vừa tạo.
const childEnv = { ...process.env, DATABASE_URL: url };
run(process.execPath, ["--env-file-if-exists=../../.env", "dist/migrate.js"], {
  cwd: join(root, "packages/db"),
  env: childEnv,
});
if (target === "dev") {
  run(process.execPath, ["--env-file-if-exists=../../.env", "dist/cli/seed.js", "--demo"], {
    cwd: join(root, "apps/api"),
    env: childEnv,
  });
}
console.log(`Đã dựng lại ${db}.`);
