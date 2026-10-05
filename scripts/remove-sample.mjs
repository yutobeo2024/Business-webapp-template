// Gỡ module MẪU (phiếu đề nghị mua hàng) khỏi dự án, trước khi viết module thật đầu tiên.
//   pnpm sample:remove [--dry-run] [--allow-dirty] [--no-verify]
// Làm gì: xóa tệp/thư mục trong scripts/sample-manifest.json, cắt khối đánh dấu `// sample:begin` ... `// sample:end`,
// dòng có `// sample` (markdown: `<!-- sample:begin -->` ... `<!-- sample:end -->`; khối `<!-- sample:after-remove ... -->`
// được mở ra thành nội dung thường), sinh migration xóa bảng mẫu, format, kiểm không còn tham chiếu, chạy verify:quick.
// Chạy lại khi đã gỡ: không làm gì.
// Chỉ dùng TRƯỚC lần phát hành đầu tiên: sau đó bảng mẫu có thể đã có dữ liệu thật trên server, phải gỡ theo
// expand/contract (skill /db-migration), không xóa tự động.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".turbo",
  "coverage",
  "test-results",
  "playwright-report",
  ".data",
]);

/**
 * Cắt phần mẫu khỏi nội dung một tệp. Ném lỗi nếu đánh dấu lệch (begin không có end, lồng nhau): khi đó không tệp nào
 * bị sửa (kiểm hết rồi mới ghi).
 */
export function stripSample(text, kind) {
  const lines = text.split("\n");
  const out = [];
  const isMd = kind === "md";
  const begin = isMd ? /<!--\s*sample:begin\b.*-->/ : /\/\/\s*sample:begin\b/;
  const end = isMd ? /<!--\s*sample:end\s*-->/ : /\/\/\s*sample:end\b/;
  // Dòng đơn: chú thích `// sample` ở cuối dòng, hoặc `// sample: lý do`.
  const single = isMd ? null : /\/\/\s*sample(\s*$|:(?!begin\b|end\b))/;
  let inBlock = 0;
  let inAfter = false;
  for (const [i, line] of lines.entries()) {
    if (begin.test(line)) {
      if (inBlock) throw new Error(`dòng ${i + 1}: sample:begin lồng trong khối khác`);
      inBlock = i + 1;
      continue;
    }
    if (end.test(line)) {
      if (!inBlock) throw new Error(`dòng ${i + 1}: sample:end không có sample:begin`);
      inBlock = 0;
      continue;
    }
    if (inBlock) continue;
    if (isMd && /^\s*<!--\s*sample:after-remove\s*$/.test(line)) {
      inAfter = true;
      continue;
    }
    if (isMd && inAfter && /^\s*-->\s*$/.test(line)) {
      inAfter = false;
      continue;
    }
    if (single?.test(line)) continue;
    out.push(line);
  }
  if (inBlock) throw new Error(`dòng ${inBlock}: sample:begin không có sample:end`);
  if (inAfter) throw new Error("sample:after-remove không đóng bằng -->");
  return out.join("\n");
}

/**
 * Lý do coi dự án là ĐÃ PHÁT HÀNH (không được gỡ mẫu tự động): có ghi chép trong docs/runbooks/releases/, có tag
 * `vX.Y.Z` (production deploy theo tag), hoặc không kiểm được tag vì không phải repo git. `git` tiêm vào để test.
 */
export function releaseBlockers(
  root,
  git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }),
) {
  const reasons = [];
  const releases = join(root, "docs", "runbooks", "releases");
  if (existsSync(releases) && readdirSync(releases).some((f) => ![".gitkeep", "README.md"].includes(f))) {
    reasons.push("docs/runbooks/releases/ đã có ghi chép phát hành");
  }
  const tags = git(["tag", "--list", "v[0-9]*"]);
  if (tags.status !== 0) reasons.push("không phải repo git, không kiểm được tag phát hành");
  else if (tags.stdout.trim())
    reasons.push(`đã có tag phát hành (${tags.stdout.trim().split("\n")[0]}, ...)`);
  return reasons;
}

function walk(root, rel, acc) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return acc;
  if (statSync(abs).isFile()) return (acc.push(rel), acc);
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const child = join(rel, name);
    // Migration là lịch sử đã áp: không sửa.
    if (child.replaceAll("\\", "/") === "packages/db/migrations") continue;
    walk(root, child, acc);
  }
  return acc;
}

function run(cmd, args, root) {
  // Windows cần shell để chạy pnpm.cmd; ghép thành một chuỗi (tham số ở đây do script tự tạo, không từ người dùng).
  const r =
    process.platform === "win32"
      ? spawnSync([cmd, ...args.map((a) => `"${a}"`)].join(" "), { cwd: root, stdio: "inherit", shell: true })
      : spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Lệnh lỗi: ${cmd} ${args.join(" ")}`);
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry-run");
  const manifest = JSON.parse(readFileSync(join(root, "scripts", "sample-manifest.json"), "utf8"));

  const blockers = releaseBlockers(root);
  if (blockers.length) {
    console.error(
      `DỪNG: ${blockers.join("; ")}.\nBảng mẫu có thể đã có dữ liệu thật trên server: không gỡ tự động. Gỡ theo ` +
        "expand/contract (skill /db-migration): release N bỏ mã dùng bảng, release N+1 mới xóa bảng.",
    );
    process.exit(1);
  }
  if (!dry && !args.has("--allow-dirty")) {
    const st = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    if (st.status === 0 && st.stdout.trim()) {
      console.error(
        "DỪNG: còn thay đổi chưa commit. Commit trước (để `git diff` thấy rõ phần gỡ), hoặc thêm --allow-dirty.",
      );
      process.exit(1);
    }
  }

  // 1. Tính hết thay đổi trước khi ghi (đánh dấu lệch thì dừng, không sửa gì).
  const toDelete = manifest.delete.filter((p) => existsSync(join(root, p)));
  const deleted = new Set(toDelete.map((p) => p.replaceAll("\\", "/")));
  const isDeleted = (rel) => [...deleted].some((d) => rel === d || rel.startsWith(d + "/"));
  const edits = [];
  for (const rel of manifest.scan.flatMap((p) => walk(root, p, []))) {
    const r = rel.replaceAll("\\", "/");
    if (isDeleted(r) || r.startsWith("scripts/")) continue;
    const ext = extname(r);
    const kind = ext === ".md" ? "md" : CODE_EXT.has(ext) ? "code" : null;
    if (!kind) continue;
    const text = readFileSync(join(root, r), "utf8");
    if (!/sample/.test(text)) continue;
    let next;
    try {
      next = stripSample(text, kind);
    } catch (e) {
      console.error(`DỪNG: ${r}: ${e.message}`);
      process.exit(1);
    }
    if (next !== text) edits.push([r, next]);
  }

  if (toDelete.length === 0 && edits.length === 0) {
    console.log("Module mẫu đã được gỡ trước đó, không còn gì để làm.");
    return;
  }
  console.log(`Xóa ${toDelete.length} đường dẫn:\n${toDelete.map((p) => `  - ${p}`).join("\n")}`);
  console.log(`Cắt phần mẫu trong ${edits.length} tệp:\n${edits.map(([p]) => `  - ${p}`).join("\n")}`);
  if (dry) return console.log("(--dry-run: chưa sửa gì)");

  // 2. Ghi.
  for (const p of toDelete) rmSync(join(root, p), { recursive: true, force: true });
  for (const [p, text] of edits) writeFileSync(join(root, p), text);

  // 3. Migration xóa bảng mẫu (dự án chưa phát hành nên đây là contract an toàn).
  const migDir = join(root, "packages", "db", "migrations");
  const before = new Set(readdirSync(migDir));
  run("pnpm", ["db:generate", "--name", "remove_sample"], root);
  const created = readdirSync(migDir).filter((f) => f.endsWith(".sql") && !before.has(f));
  for (const f of created) {
    const file = join(migDir, f);
    writeFileSync(
      file,
      "-- contract: gỡ module mẫu bằng `pnpm sample:remove` trước lần phát hành đầu tiên, bảng mẫu chưa có dữ liệu thật\n" +
        readFileSync(file, "utf8"),
    );
    console.log(`Migration: packages/db/migrations/${f}`);
  }

  // 4. Format, rồi kiểm không còn tham chiếu.
  run("pnpm", ["exec", "prettier", "--write", "--log-level", "warn", ...edits.map(([p]) => p)], root);
  const residue = manifest.residue.map((r) => new RegExp(r));
  const left = [];
  for (const rel of manifest.scan.flatMap((p) => walk(root, p, []))) {
    const r = rel.replaceAll("\\", "/");
    if (r.startsWith("scripts/") || !/\.(ts|tsx|mts|mjs|js|json|sh|ya?ml|md)$/.test(r)) continue;
    readFileSync(join(root, r), "utf8")
      .split("\n")
      .forEach(
        (line, i) => residue.some((re) => re.test(line)) && left.push(`${r}:${i + 1}: ${line.trim()}`),
      );
  }
  const codeLeft = left.filter((l) => !/\.md:/.test(l));
  if (left.length) {
    console.warn(
      `\nCòn ${left.length} dòng nhắc tới module mẫu (sửa tay):\n${left.map((l) => `  ${l}`).join("\n")}`,
    );
  }
  if (codeLeft.length) {
    console.error(
      "\nDỪNG: mã còn tham chiếu module mẫu (đã xóa/sửa tệp nhưng chưa format/verify). Sửa các dòng trên rồi chạy" +
        " `pnpm verify:quick`, hoặc hoàn tác toàn bộ: `git restore . && git clean -fd` (chỉ an toàn khi trước đó cây sạch).",
    );
    process.exit(1);
  }

  // 5. Kiểm nhanh.
  if (!args.has("--no-verify")) run("pnpm", ["verify:quick"], root);
  console.log(
    "\nĐã gỡ module mẫu. Tiếp theo: `pnpm db:migrate` (DB dev), dựng lại DB test nếu cần, `pnpm test:integration`, " +
      "`pnpm test:e2e`, rồi commit.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
