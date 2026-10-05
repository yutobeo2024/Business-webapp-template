// Stop: trước khi Claude báo "xong", chạy pnpm verify:quick (lint + typecheck + unit test).
// Đỏ thì buộc Claude sửa tiếp, tối đa 3 lần cho mỗi trạng thái mã; sau đó nhả ra và báo thẳng cho NGƯỜI DÙNG.
// Kết quả được nhớ theo "dấu vân tay" của các thay đổi chưa commit: mã không đổi thì không chạy lại
// (lượt chỉ hỏi đáp không tốn vài phút verify; đã bó tay với một lỗi thì không ép sửa lại từ đầu ở lượt sau).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pass, projectDir, readInput, tail } from "./_lib.mjs";

const MAX_RETRY = 3;
const input = readInput();
const root = projectDir(input);
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Cho qua, kèm thông báo hiện cho người dùng (stderr khi exit 0 chỉ vào debug log, không ai thấy). */
function passWithMessage(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }) + "\n");
  process.exit(0);
}

// Thay đổi chưa commit, trừ tài liệu. Tính cả file cấu hình ở gốc (package.json, eslint, turbo): sửa chúng cũng
// có thể làm verify đỏ hoặc làm yếu chính verify.
const SCOPE = ["--", ".", ":(exclude)docs", ":(exclude)*.md", ":(exclude).claude/hooks/.state"];
const status = git(["status", "--porcelain", ...SCOPE]);
if (status.status !== 0)
  passWithMessage("stop-verify: thư mục dự án chưa phải repo git, bỏ qua kiểm tra tự động.");
if (!status.stdout.trim()) pass();
if (!existsSync(join(root, "node_modules"))) {
  passWithMessage("stop-verify: chưa có node_modules (chạy pnpm install), bỏ qua verify:quick.");
}

function fingerprint() {
  // diff --cached + diff (không dùng "diff HEAD": repo vừa git init chưa có HEAD, lệnh lỗi và dấu vân tay đứng yên).
  const h = createHash("sha256")
    .update(status.stdout)
    .update(git(["diff", "--cached", ...SCOPE]).stdout ?? "")
    .update(git(["diff", ...SCOPE]).stdout ?? "");
  // File chưa track không có trong git diff: lấy kích thước và thời điểm sửa.
  for (const f of (git(["ls-files", "-o", "--exclude-standard", ...SCOPE]).stdout ?? "").split("\n")) {
    if (!f) continue;
    try {
      const s = statSync(join(root, f));
      h.update(`${f}:${s.size}:${s.mtimeMs}`);
    } catch {
      h.update(f);
    }
  }
  return h.digest("hex");
}

// Lưu trong .claude/hooks/.state (gitignore): protect-files và guard-bash đã khóa thư mục hooks, nên không tự ghi
// "green" vào đây để bỏ qua verify được. Thư mục tạm của hệ thống thì ghi được tự do.
const stateDir = join(root, ".claude", "hooks", ".state");
const stateFile = join(stateDir, `verify-${String(input.session_id || "default").replace(/\W/g, "")}.json`);
function loadState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    /* không ghi được trạng thái thì lần sau kiểm lại, vẫn an toàn */
  }
}

const fp = fingerprint();
const state = loadState();
if (state.fingerprint === fp && state.verdict === "green") pass();
if (state.fingerprint === fp && state.verdict === "gave-up") pass(); // đã báo người dùng ở lượt bó tay

// Một chuỗi lệnh + shell: chạy được pnpm.cmd trên Windows, không dùng mảng đối số kèm shell (Node cảnh báo DEP0190).
const r = spawnSync("pnpm run verify:quick", {
  cwd: root,
  encoding: "utf8",
  shell: true,
  timeout: 540_000,
});
if (r.status === 0) {
  saveState({ fingerprint: fp, verdict: "green", count: 0 });
  pass();
}

// Đếm số lần đỏ liên tiếp trong phiên (mã đổi sau mỗi lần sửa nên không đếm theo dấu vân tay).
const count = (state.verdict === "red" ? (state.count ?? 0) : 0) + 1;
if (count > MAX_RETRY) {
  saveState({ fingerprint: fp, verdict: "gave-up", count: 0 });
  passWithMessage(
    `pnpm verify:quick vẫn ĐỎ sau ${MAX_RETRY} lần sửa. Claude được phép dừng nhưng công việc CHƯA đạt: ` +
      "xem lỗi bằng `pnpm verify:quick` trước khi dùng kết quả.",
  );
}
saveState({ fingerprint: fp, verdict: "red", count });
process.stderr.write(
  `pnpm verify:quick đang ĐỎ (lần ${count}/${MAX_RETRY}). Chưa được báo hoàn thành.\n` +
    "Sửa nguyên nhân gốc. Không xóa/skip test, không thêm eslint-disable hay @ts-ignore để lách.\n" +
    "Nếu lỗi nằm ngoài phạm vi task, dừng lại và báo người dùng.\n\n" +
    tail(r.stdout + r.stderr, 80) +
    "\n",
);
process.exit(2);
