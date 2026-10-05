// PostToolUse (Edit, Write): format + lint NGAY file vừa sửa. Còn lỗi lint thì báo lại để Claude sửa tiếp.
// Gọi thẳng prettier/eslint bằng node (không qua shim .cmd) để chạy được trên Windows.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pass, projectDir, readInput, relPath, tail } from "./_lib.mjs";

const input = readInput();
const raw = input?.tool_input?.file_path;
if (!raw) pass();
const root = projectDir(input);
const rel = relPath(raw, root);
const abs = join(root, rel);
if (rel.startsWith("../") || !existsSync(abs) || !existsSync(join(root, "node_modules"))) pass();

const req = createRequire(join(root, "package.json"));

/** Tìm file bin của một package qua trường "bin" (nhiều package như eslint không export đường dẫn bin). */
function binOf(pkg) {
  let dir;
  try {
    dir = dirname(req.resolve(`${pkg}/package.json`));
  } catch {
    try {
      dir = dirname(req.resolve(pkg));
    } catch {
      return null;
    }
  }
  for (let i = 0; i < 6 && dir; i++, dir = dirname(dir)) {
    const pj = join(dir, "package.json");
    if (!existsSync(pj)) continue;
    const meta = JSON.parse(readFileSync(pj, "utf8"));
    if (meta.name !== pkg) continue;
    const rel = typeof meta.bin === "string" ? meta.bin : meta.bin?.[pkg];
    return rel ? join(dir, rel) : null;
  }
  return null;
}
const run = (script, args) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 45_000 });

const prettier = binOf("prettier");
const eslint = binOf("eslint");
// Thiếu công cụ là lỗi cài đặt: báo to, không âm thầm bỏ qua kiểm tra.
if (!prettier || !eslint) {
  process.stderr.write(
    "Không tìm thấy prettier/eslint trong node_modules. Đề nghị người dùng chạy pnpm install.\n",
  );
  process.exit(2);
}
if (/\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|ya?ml)$/.test(rel)) {
  run(prettier, ["--write", "--log-level", "warn", "--ignore-unknown", rel]);
}

if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel) && !rel.startsWith(".claude/")) {
  const r = run(eslint, ["--fix", "--max-warnings", "0", "--no-warn-ignored", rel]);
  if (r.status !== 0) {
    process.stderr.write(
      `ESLint còn lỗi trong ${rel}. Sửa trước khi làm tiếp:\n${tail(r.stdout + r.stderr, 40)}\n`,
    );
    process.exit(2);
  }
}
pass();
