// Chặn migration phá tương thích ngược mà không được đánh dấu là bước "contract".
//   node scripts/check-migrations.mjs        (CI chạy ở mọi PR)
// Vì sao: deploy lỗi thì hệ thống tự quay IMAGE về bản trước nhưng KHÔNG đảo migration. Nếu migration vừa xóa/đổi tên
// cột mà bản trước còn dùng, bản trước lỗi 500 trên schema mới trong khi health check vẫn xanh.
// Quy trình đúng (skill /db-migration): release N thêm cấu trúc mới (expand), release N+1 mới bỏ cấu trúc cũ (contract).
// Migration contract phải có dòng chú thích:  -- contract: <release đã ngừng dùng cấu trúc cũ, lý do>
// (dòng này miễn trừ cả file: mỗi file migration là một đơn vị, bước contract nên nằm riêng một file).
// Đây là lưới bắt lỗi thường gặp, không thay cho việc đọc SQL: ràng buộc UNIQUE/CHECK mới cũng có thể phá bản cũ.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// So trên từng câu lệnh đã chuẩn hóa: định danh trong nháy kép thành ID, chuỗi thành '', bỏ chú thích.
const RULES = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+SCHEMA\b/i, "DROP SCHEMA"],
  [/\bDROP\s+TYPE\b/i, "DROP TYPE"],
  // Bản cũ còn gọi nextval/view/function sẽ lỗi khi rollback image.
  [
    /\bDROP\s+(SEQUENCE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TRIGGER)\b/i,
    "DROP SEQUENCE/VIEW/FUNCTION",
  ],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bDROP\s+(COLUMN\s+(IF\s+EXISTS\s+)?)?ID\b/i, "DROP COLUMN"],
  [/\bRENAME\s+(COLUMN\s+|VALUE\s+)?(ID\s+|''\s+)?TO\b/i, "RENAME"],
  [/\bALTER\s+COLUMN\s+ID\s+SET\s+NOT\s+NULL\b/i, "SET NOT NULL"],
  [/\bALTER\s+COLUMN\s+ID\s+(SET\s+DATA\s+)?TYPE\b/i, "ALTER COLUMN TYPE"],
  // Bản cũ INSERT không có cột này sẽ lỗi.
  [
    (s) => /\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s),
    "ADD COLUMN NOT NULL không có DEFAULT",
  ],
];
const CONTRACT_MARK = /^\s*--\s*contract:\s*\S+/im;

/** Danh sách thao tác phá tương thích trong một file migration; rỗng nếu an toàn hoặc đã đánh dấu contract. */
export function findUnmarkedDestructive(sql) {
  if (CONTRACT_MARK.test(sql)) return [];
  const statements = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, "ID")
    .split(";")
    // Đổi tên index không ảnh hưởng mã ứng dụng.
    .filter((s) => s.trim() && !/^\s*ALTER\s+INDEX\b/i.test(s));
  const found = new Set();
  for (const s of statements) {
    for (const [rule, label] of RULES) {
      if (typeof rule === "function" ? rule(s) : rule.test(s)) found.add(label);
    }
  }
  return [...found];
}

function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "db", "migrations");
  let failed = false;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const found = findUnmarkedDestructive(readFileSync(join(dir, file), "utf8"));
    if (found.length === 0) continue;
    failed = true;
    console.error(
      `${file}: ${found.join(", ")} phá tương thích với bản đang chạy (rollback image sẽ lỗi).\n` +
        "  Tách expand/contract theo /db-migration. Nếu đây đúng là bước contract, thêm dòng:\n" +
        "  -- contract: <release đã ngừng dùng cấu trúc cũ, lý do>",
    );
  }
  if (failed) process.exit(1);
  console.log("check-migrations: không có migration phá tương thích chưa đánh dấu");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
