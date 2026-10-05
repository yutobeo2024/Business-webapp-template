// Khởi tạo dự án vừa tạo từ kit (bấm "Use this template" trên GitHub rồi clone, hoặc installer gọi). Chạy một lần:
//   pnpm project:setup [--force]
// - Kiểm Node 22/24 (dự án khóa engine; Node khác thì mọi lệnh pnpm lồng nhau, kể cả hook của Claude Code, đều lỗi).
// - Tạo .env từ .env.example nếu chưa có: tên DB dev/test và chỉ số Redis riêng theo tên thư mục dự án, để nhiều dự án
//   dùng chung Postgres/Redis của `pnpm dev:services` mà không đụng nhau. Có .env rồi thì không đụng.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Tên thư mục -> định danh DB: bỏ dấu tiếng Việt, chữ thường, `_`, tối đa 40 ký tự, bắt đầu bằng chữ. */
export function slugify(name) {
  const ascii = name.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  const s = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return /^[a-z]/.test(s) ? s : `app_${s}`;
}

/** Chỉ số Redis dev (1-7) và test (8-15) theo băm của tên: hai dự án hiếm khi trùng, test luôn khác dev và khác 0. */
export function redisIndexes(slug) {
  const h = createHash("sha256").update(slug).digest().readUInt32BE(0);
  return { dev: 1 + (h % 7), test: 8 + (h % 8) };
}

/** Nội dung .env từ .env.example: thay tên DB `app_dev`/`app_test` và chỉ số Redis mẫu bằng giá trị riêng của dự án. */
export function buildEnv(example, folderName) {
  const slug = slugify(folderName);
  const r = redisIndexes(slug);
  return example
    .replace(/\/app_dev(?=\r?$)/m, `/${slug}_dev`)
    .replace(/\/app_test(?=\r?$)/m, `/${slug}_test`)
    .replace(/^REDIS_URL=redis:\/\/localhost:6379\/1(?=\r?$)/m, `REDIS_URL=redis://localhost:6379/${r.dev}`)
    .replace(
      /^TEST_REDIS_URL=redis:\/\/localhost:6379\/15(?=\r?$)/m,
      `TEST_REDIS_URL=redis://localhost:6379/${r.test}`,
    );
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const force = process.argv.includes("--force");
  const major = process.versions.node.split(".")[0];
  if (!["22", "24"].includes(major) && !force) {
    console.error(
      `Cần Node 22 hoặc 24 LTS, máy đang có: ${major}.\n` +
        "Cài Node 24 bên cạnh bản hiện có rồi chạy lại, ví dụ:\n" +
        "  fnm install 24 && fnm use 24        (Windows: winget install Schniz.fnm)\n" +
        "  nvm install 24 && nvm use 24        (macOS/Linux: nvm; Windows: nvm-windows)\n" +
        "Vẫn muốn tiếp tục (tự lo Node sau): pnpm project:setup --force",
    );
    process.exit(1);
  }
  const envFile = join(root, ".env");
  if (existsSync(envFile)) {
    console.log(".env đã có: giữ nguyên.");
  } else {
    writeFileSync(envFile, buildEnv(readFileSync(join(root, ".env.example"), "utf8"), basename(root)));
    const db = /^DATABASE_URL=.*\/([^/\s]+)$/m.exec(readFileSync(envFile, "utf8"))?.[1];
    console.log(`Đã tạo .env (DB dev: ${db}). Đổi SEED_ADMIN_PASSWORD trước khi seed.`);
  }
  console.log(`Tiếp theo:
  pnpm install && pnpm dev:services && pnpm build
  pnpm db:reset-local dev && pnpm db:reset-local   # tạo DB dev (kèm dữ liệu demo) và DB test riêng của dự án
  pnpm verify:quick && pnpm claude:selftest
Sửa phần <...> trong CLAUDE.md và README.md. Nhánh chính là main (CI/CD chạy khi push main và tag vX.Y.Z).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
