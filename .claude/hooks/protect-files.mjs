// PreToolUse (Edit, Write, MultiEdit, NotebookEdit): bảo vệ file nhạy cảm và chính cơ chế bảo vệ.
import { readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { block, isGitTracked, pass, projectDir, readInputStrict, resolveTarget } from "./_lib.mjs";

const input = readInputStrict();
if (!input) block("protect-files: không đọc được input của hook, chặn để an toàn.");
const raw = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!raw) pass();
const root = projectDir(input);
const { abs, rel, key, outside, ads } = resolveTarget(raw, root);

if (ads) {
  block(`Đường dẫn có ":" (NTFS alternate data stream) bị chặn: ${raw}`);
}
/** abs nằm trong thư mục dir (so khớp không phân biệt hoa thường trên Windows). */
const inside = (dir) => {
  const r = relative(dir, abs);
  return !!r && !r.startsWith("..") && !/^[a-zA-Z]:|^[\\/]/.test(r);
};
// Ngoài dự án chỉ cho ghi file làm việc của chính Claude Code: kế hoạch, memory, thư mục tạm.
const realDir = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
};
const claudeWork = [
  join(homedir(), ".claude", "plans"),
  join(homedir(), ".claude", "projects"),
  tmpdir(),
].map(realDir);
if (outside && !claudeWork.some(inside)) {
  block(`Không sửa file ngoài dự án: ${raw}`);
}
if (outside) pass();
if (/(^|\/)\.env(\.[^/]+)?$/.test(key) && !key.endsWith(".env.example")) {
  block(`Không sửa ${rel}: file chứa secret. Chỉ sửa .env.example (giá trị mẫu, không phải secret thật).`);
}
// Migration đã commit có thể đã chạy trên staging/production: sửa lại sẽ làm lệch schema giữa các môi trường.
// Migration mới tạo (chưa commit, ví dụ từ drizzle-kit generate --custom) vẫn được điền nội dung.
if (key.startsWith("packages/db/migrations/") && isGitTracked(rel, root)) {
  block(
    `Không sửa migration đã commit: ${rel}. Tạo migration mới bằng: pnpm db:generate --name <ten_thay_doi>`,
  );
}
if (/(^|\/)pnpm-lock\.yaml$/.test(key)) {
  block("Không sửa tay pnpm-lock.yaml. Đề nghị người dùng chạy pnpm add/remove.");
}
if (/^\.claude\/(hooks\/|settings(\.local)?\.json$)/.test(key)) {
  block(`Không sửa ${rel}: đây là cơ chế bảo vệ của dự án. Trình bày thay đổi đề xuất để người dùng tự sửa.`);
}
if (key === ".git" || key.startsWith(".git/")) {
  block("Không sửa nội bộ thư mục .git.");
}
if (/^(\.github\/workflows\/|infra\/)/.test(key) && process.env.ALLOW_INFRA_EDIT !== "1") {
  block(
    `Không tự sửa ${rel} (CI/CD, hạ tầng production). Trình bày thay đổi đề xuất. ` +
      "Người dùng có thể mở phiên với ALLOW_INFRA_EDIT=1 nếu muốn giao việc này.",
  );
}

if (key === "turbo.json") {
  block(
    "Không tự sửa turbo.json: nó quyết định verify:quick chạy những gì. Trình bày thay đổi đề xuất để người dùng tự sửa.",
  );
}
// package.json gốc và của từng app/package: các script dưới đây là cổng kiểm tra (hook Stop và CI gọi chúng, gốc gọi
// qua turbo tới từng package). Sửa "verify:quick" hay "test" thành "echo ok" là cách dễ nhất để báo xong khi test
// còn đỏ. Các phần khác của file vẫn sửa được.
if (/^((apps|packages)\/[^/]+\/)?package\.json$/.test(key)) {
  const GUARDED = [
    "verify:quick",
    "lint",
    "typecheck",
    "test",
    "test:integration",
    "claude:selftest",
    "build",
  ];
  const scriptsOf = (text) => {
    try {
      return JSON.parse(text).scripts ?? {};
    } catch {
      return null; // nội dung mới không phải JSON hợp lệ
    }
  };
  let before = "";
  try {
    before = readFileSync(abs, "utf8");
  } catch {
    /* file chưa tồn tại */
  }
  // Nội dung sau khi áp dụng thao tác: Write (content), Edit (old/new_string), MultiEdit (edits[]).
  const ti = input.tool_input ?? {};
  const edits = Array.isArray(ti.edits) ? ti.edits : ti.old_string !== undefined ? [ti] : [];
  let after = typeof ti.content === "string" ? ti.content : before;
  for (const e of edits) {
    const from = String(e.old_string ?? "");
    const to = String(e.new_string ?? "");
    after = e.replace_all ? after.split(from).join(to) : after.replace(from, () => to);
  }
  const a = scriptsOf(before);
  const b = scriptsOf(after);
  const changed = a && GUARDED.filter((k) => k in a && (!b || a[k] !== b[k]));
  if (changed?.length) {
    block(
      `Không tự sửa script ${changed.join(", ")} trong ${rel}: đây là cổng kiểm tra của dự án. ` +
        "Trình bày thay đổi đề xuất để người dùng tự sửa.",
    );
  }
}
pass();
