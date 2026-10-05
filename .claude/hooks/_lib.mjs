// Tiện ích dùng chung cho hook. Hook nhận JSON qua stdin.
// Quy ước Claude Code: exit 0 = cho qua; exit 2 = chặn (PreToolUse/Stop) hoặc báo lại cho Claude (PostToolUse), nội dung qua stderr.
// Không dùng thư viện ngoài: hook phải chạy được cả khi chưa pnpm install.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const WIN = process.platform === "win32";

/** Đọc JSON từ stdin. Hỏng thì trả {} (hook không bảo vệ gì, ví dụ post-edit, stop-verify). */
export function readInput() {
  return readInputStrict() ?? {};
}

/** Như readInput nhưng trả null khi JSON hỏng, để hook bảo vệ CHẶN thay vì âm thầm cho qua (fail-closed). */
export function readInputStrict() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return null;
  }
}

export function block(message) {
  process.stderr.write(String(message).trim() + "\n");
  process.exit(2);
}

export function pass() {
  process.exit(0);
}

export function projectDir(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
}

/** Đường dẫn tương đối so với gốc dự án, dạng POSIX. Trên Windows file_path đến với dấu "\". */
export function relPath(filePath, root) {
  const abs = isAbsolute(filePath) ? filePath : join(root, filePath);
  return relative(root, abs).split("\\").join("/");
}

const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return p; // file chưa tồn tại
  }
};

/**
 * Phân tích đường dẫn mục tiêu để SO KHỚP luật bảo vệ.
 * - key: tương đối so với gốc, POSIX, chữ thường trên Windows (NTFS không phân biệt hoa thường: ".ENV" chính là ".env").
 * - outside: nằm ngoài dự án, kể cả khác ổ đĩa (path.relative khi đó trả đường dẫn tuyệt đối, không bắt đầu bằng "../").
 * - ads: có ":" sau ổ đĩa, tức NTFS alternate data stream (".env::$DATA" ghi thẳng vào .env).
 * Symlink được giải về đích thật.
 */
export function resolveTarget(filePath, root) {
  // Git Bash trên Windows viết ổ đĩa là /d/...: đổi thành D:/... (nếu không, Node hiểu thành D:\d\...).
  if (WIN) filePath = filePath.replace(/^\/([a-zA-Z])(\/|$)/, (_, d, s) => `${d.toUpperCase()}:${s || "/"}`);
  const abs = real(isAbsolute(filePath) ? filePath : join(root, filePath));
  const r = relative(real(root), abs);
  const rel = r.split("\\").join("/");
  return {
    abs,
    rel,
    key: WIN ? rel.toLowerCase() : rel,
    outside: isAbsolute(r) || rel === ".." || rel.startsWith("../"),
    ads: WIN && abs.slice(2).includes(":"),
  };
}

export function isGitTracked(rel, root) {
  // Windows: so khớp không phân biệt hoa thường, giống hệ thống file.
  const spec = WIN ? `:(icase)${rel}` : rel;
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", spec], { cwd: root, stdio: "ignore" });
  return r.status === 0;
}

export function tail(text, lines) {
  return String(text || "")
    .trim()
    .split("\n")
    .slice(-lines)
    .join("\n");
}
