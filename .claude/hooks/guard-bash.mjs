// PreToolUse (Bash, PowerShell): chặn lệnh phá dữ liệu hoặc vượt quy trình TRƯỚC khi chạy.
// Đây là luật cứng chạy bằng code, không phụ thuộc AI có nhớ CLAUDE.md hay không.
// Cách làm: tách chuỗi thành từng lệnh đơn theo cú pháp shell (nháy, escape, ; && || |, $( ), `...`), xét cả lệnh lồng
// ($(...) trong nháy kép, bash -c, eval), bỏ tiền tố (VAR=x, sudo -u x, timeout 60, env, đường dẫn binary),
// rồi xét tên lệnh và đối số ở MỌI vị trí. Một regex trên cả chuỗi bị lách quá dễ.
// Giới hạn: không đọc được mã bên trong node -e, python -c... (xem README "Giới hạn cần biết").
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { block, isGitTracked, pass, projectDir, readInputStrict, resolveTarget } from "./_lib.mjs";

const input = readInputStrict();
if (!input) block("guard-bash: không đọc được input của hook, chặn để an toàn.");
const cmd = String(input?.tool_input?.command ?? "");
if (!cmd.trim()) pass();
const root = projectDir(input);
const isPowerShell = input?.tool_name === "PowerShell";
const infraLocked = process.env.ALLOW_INFRA_EDIT !== "1";

// ---------- Tách lệnh ----------

/** Vị trí ")" đóng của "$(" bắt đầu tại start (sau "$("). */
function closingParen(text, start) {
  let depth = 1;
  let q = null;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (q) {
      if (ch === q) q = null;
    } else if (ch === "'" || ch === '"') {
      q = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")" && --depth === 0) {
      return j;
    }
  }
  return text.length;
}

/**
 * Tách thành lệnh đơn (mảng token đã bỏ nháy và escape: "/" chính là /, r\m chính là rm).
 * Nội dung trong nháy là một token (dấu ; ( ) trong commit message hay biểu thức sed không cắt lệnh).
 * Ghi ra file (>, >>, &>) thành token ">" đứng trước file đích. Lệnh lồng $(...), `...`, <(...) vừa giữ nguyên trong
 * token (để nhận ra rm -rf $(pwd)) vừa được tách thành lệnh riêng để xét, kể cả khi nằm trong nháy kép.
 */
function commandsOf(text, depth = 0) {
  const cmds = [];
  const nested = [];
  let cur = [];
  let tok = "";
  let quoted = false;
  let quote = null;
  const esc = isPowerShell ? "`" : "\\";
  const endTok = () => {
    if (tok || quoted) cur.push(tok);
    tok = "";
    quoted = false;
  };
  const endCmd = () => {
    endTok();
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  const redirect = () => {
    if (/^\d+$/.test(tok)) tok = ""; // 2> : số fd không phải đối số
    endTok();
    cur.push(">");
    while (/[>|]/.test(text[i + 1] ?? "")) i++;
  };
  let i = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      else tok += c; // nháy đơn: nguyên văn, không thay thế lệnh
    } else if (c === esc && n !== undefined && quote !== "'") {
      if (n !== "\n" && n !== "\r") tok += n;
      i++;
    } else if (c === "$" && n === "(") {
      const end = closingParen(text, i + 2);
      nested.push(text.slice(i + 2, end));
      tok += text.slice(i, end + 1);
      i = end;
    } else if (c === "`" && !isPowerShell) {
      const end = text.indexOf("`", i + 1);
      const stop = end < 0 ? text.length : end;
      nested.push(text.slice(i + 1, stop));
      tok += text.slice(i, stop + 1);
      i = stop;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else tok += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      quoted = true;
    } else if (c === "$" && n === "{") {
      const end = text.indexOf("}", i);
      tok += end < 0 ? text.slice(i) : text.slice(i, end + 1);
      i = end < 0 ? text.length : end;
    } else if ((c === "<" || c === ">") && n === "(") {
      const end = closingParen(text, i + 2);
      nested.push(text.slice(i + 2, end));
      i = end;
    } else if (c === ">" && n === "&") {
      if (/^\d+$/.test(tok)) tok = ""; // 2>&1: nhân bản fd, không ghi file
      i++;
      while (/[\d-]/.test(text[i + 1] ?? "")) i++;
    } else if (c === ">" || (c === "&" && n === ">")) {
      if (c === "&") i++;
      redirect();
    } else if (/[;&|(){}\r\n]/.test(c)) {
      endCmd();
    } else if (/\s/.test(c)) {
      endTok();
    } else {
      tok += c;
    }
  }
  endCmd();
  if (depth < 5) for (const inner of nested) cmds.push(...commandsOf(inner, depth + 1));
  return cmds;
}

const base = (tok) =>
  tok
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, "");
const isAssign = (tok) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok);

// Tiền tố chạy lệnh khác; giá trị là các option có đối số đi kèm (phải bỏ cả đối số).
const WRAPPERS = new Map([
  ["sudo", /^-[ugCDhprtTU]$/],
  ["doas", /^-[uC]$/],
  ["command", null],
  ["builtin", null],
  ["exec", /^-a$/],
  ["nohup", null],
  ["time", /^-[fo]$/],
  ["nice", /^-n$/],
  ["ionice", /^-[cnp]$/],
  ["stdbuf", /^-[ioe]$/],
  ["timeout", /^-[sk]$/],
  ["xargs", /^-[nIPdLsaE]$/],
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "pwsh", "powershell", "cmd"]);
const SHELL_INLINE = /^([-+][a-z]*c|\/[ck]|-c(o(m(m(a(n(d)?)?)?)?)?)?)$/i;
const SHELL_VALUE_OPT =
  /^([-+]o|-O|--rcfile|--init-file|-(executionpolicy|ep|ex|workingdirectory|wd|outputformat|of|inputformat|if|windowstyle|w|configurationname|settingsfile))$/i;

/** Bỏ tiền tố không đổi bản chất lệnh. Trả ["env"] khi lệnh chỉ in biến môi trường. */
function unwrap(tokens) {
  let t = tokens;
  for (let guard = 0; guard < 10 && t.length; guard++) {
    const name = base(t[0]);
    if (isAssign(t[0])) {
      t = t.slice(1);
    } else if (WRAPPERS.has(name)) {
      const valueOpt = WRAPPERS.get(name);
      t = t.slice(1);
      while (t[0]?.startsWith("-")) t = t.slice(valueOpt?.test(t[0]) ? 2 : 1);
      if (name === "timeout" && t.length) t = t.slice(1); // thời lượng
    } else if (name === "env") {
      let i = 1;
      while (i < t.length && (t[i].startsWith("-") || isAssign(t[i]))) i += /^-[uCS]$/.test(t[i]) ? 2 : 1;
      if (i >= t.length) return ["env"];
      t = t.slice(i);
    } else {
      break;
    }
  }
  return t;
}

/** Shell chạy lệnh trong chuỗi (bash -x -c '...', pwsh -NoProfile -Command "...", cmd /c): trả chuỗi lệnh đó. */
function shellInline(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_INLINE.test(a)) return args.slice(args[i + 1] === "--" ? i + 2 : i + 1).join(" ");
    if (SHELL_VALUE_OPT.test(a)) i++;
    else if (!/^[-+/]/.test(a)) return null; // gặp tên script
  }
  return null;
}

// ---------- Nhận diện ----------

const norm = (tok) => tok.replace(/\\/g, "/").toLowerCase();
const MAIN_BRANCHES = new Set(["main", "master", "production", "release"]);
const DELETE_CMDS = new Set(["rm", "remove-item", "ri", "del", "erase", "rd", "rmdir"]);
const CMD_SLASH_FLAGS = new Set(["rd", "rmdir", "del", "erase"]); // cmd.exe: /s /q là cờ, không phải đường dẫn
const READERS = new Set([
  ...[
    "cat",
    "less",
    "more",
    "head",
    "tail",
    "grep",
    "egrep",
    "rg",
    "bat",
    "wc",
    "diff",
    "file",
    "stat",
    "ls",
  ],
  ...["shellcheck", "git", "code", "type", "get-content", "gc", "select-string", "dir", "nl", "sed"],
]);

/** Cờ đệ quy: -r, -R, cụm cờ có r (-rf, -dfrvR), --recursive, PowerShell -Rec... (nhận viết tắt), cmd /s. */
const isRecursive = (a) =>
  /^(--recursive|\/s)$/i.test(a) ||
  /^-rec/i.test(a) ||
  (/^-[a-z]+$/i.test(a) && /r/i.test(a) && !/^-force$/i.test(a));

/** Gốc ổ đĩa, home, thư mục cha, cả thư mục hiện tại. */
function dangerousTarget(tok) {
  let p = norm(tok);
  if (/^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%)(\/|$)/.test(p)) return true;
  if (/^(\$pwd|\$\{pwd\}|\$\(pwd\)|`pwd`|%cd%|\$\(get-location\))(\/|$)/.test(p)) return true;
  if (/^\.\.(\/|$)/.test(p)) return true;
  p = p
    .replace(/\/?\*$/, "")
    .replace(/\/+$/, "")
    .replace(/^\.\/$/, ".");
  return p === "" || p === "." || /^[a-z]:$/.test(p) || /^\/[a-z]$/.test(p); // /c: ổ C trong Git Bash
}

/** File .env chứa secret (kể cả .env.local, .env*, --env-file=.env); .env.example là mẫu, cho qua. */
function isEnvFile(tok) {
  const b = norm(tok).split(/[/=]/).pop();
  return /^\.env($|[.*?[])/.test(b) && b !== ".env.example";
}

// Ngoài dự án chỉ được ghi vào thư mục tạm và thư mục làm việc của Claude Code (giống protect-files): agent không
// được rải file (patch, bản sao, log) ra thư mục khác trên máy người dùng.
const realDir = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
};
const OUTSIDE_OK = [
  join(homedir(), ".claude", "plans"),
  join(homedir(), ".claude", "projects"),
  tmpdir(),
].map(realDir);
const DEVICES = /^(\/dev\/(null|stdout|stderr|tty|fd\/\d+)|nul|con|\$null)$/i;
function outsideAllowed(t, abs) {
  if (DEVICES.test(t) || /^\/tmp(\/|$)/.test(t) || /^\/dev\//.test(t)) return true;
  return OUTSIDE_OK.some((d) => {
    const r = relative(d, abs);
    return !r.startsWith("..") && !/^[a-zA-Z]:|^[\\/]/.test(r);
  });
}

/** Lý do nếu ghi vào file/thư mục này phá cơ chế bảo vệ; null nếu được ghi. */
function protectedReason(tok) {
  const t = tok.replace(/^[<>]+/, "").replace(/\\/g, "/");
  if (!t || t.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^&\d$/.test(t)) return null;
  if (DEVICES.test(t)) return null;
  // Shell mở rộng ~ và $HOME trước khi chạy: xét đúng nơi sẽ ghi.
  const home = /^(~|\$HOME|\$\{HOME\})(\/|$)/.exec(t);
  const target = home ? join(homedir(), t.slice(home[1].length)) : t;
  const { abs, rel, key, outside } = resolveTarget(target, root);
  if (outside) {
    return outsideAllowed(t, abs)
      ? null
      : `ghi ra ngoài thư mục dự án (${t}). Để thay đổi trong dự án (ví dụ staging) hoặc dùng thư mục tạm.`;
  }
  if (key === ".claude" || /^\.claude\/(hooks(\/|$)|settings(\.local)?\.json$)/.test(key))
    return `${rel} là cơ chế bảo vệ của dự án (hook, settings).`;
  if (/(^|\/)pnpm-lock\.yaml$/.test(key)) return "pnpm-lock.yaml chỉ được đổi qua pnpm add/remove.";
  // package.json gốc chứa các script là cổng kiểm tra (verify:quick, lint...). Sửa bằng công cụ Edit để
  // protect-files soát được nội dung; dependency thì dùng pnpm add/remove.
  // Tương tự cho package.json của từng app/package (verify:quick gọi script test, typecheck của chúng) và turbo.json.
  if (/^((apps|packages)\/[^/]+\/)?package\.json$/.test(key))
    return `${rel} chỉ sửa bằng công cụ Edit hoặc pnpm add/remove.`;
  if (key === "turbo.json") return "turbo.json điều khiển verify:quick, không sửa qua shell.";
  if (/^\.claude\/hooks\/\.state(\/|$)/.test(key)) return "trạng thái của hook.";
  if (
    key === "packages/db/migrations" ||
    (key.startsWith("packages/db/migrations/") && isGitTracked(rel, root))
  )
    return `Không sửa migration đã commit (${rel}). Tạo migration mới.`;
  if (infraLocked && (key === ".github" || /^(infra|\.github\/workflows)(\/|$)/.test(key)))
    return `${rel} là CI/CD, hạ tầng production (cần ALLOW_INFRA_EDIT=1).`;
  return null;
}

// Lệnh ghi/xóa: mọi đối số là mục tiêu. Lệnh sao chép: đích (đối số cuối hoặc -t <thư mục>).
const WRITE_ALL = new Set([
  ...DELETE_CMDS,
  ...["tee", "truncate", "shred", "unlink", "ln", "chmod", "chown", "mv", "move", "move-item", "mi"],
  ...["set-content", "sc", "add-content", "ac", "out-file", "clear-content", "clc", "new-item", "ni"],
  ...["rename-item", "ren", "rni"],
]);
const WRITE_LAST = new Set(["cp", "copy", "copy-item", "cpi", "install", "rsync", "scp"]);

const OUTPUT_OPT_CMDS = new Set([
  ...["curl", "wget", "tar", "unzip", "7z", "bsdtar"],
  ...["iwr", "irm", "invoke-webrequest", "invoke-restmethod", "expand-archive"],
]);
const OUTPUT_OPT = /^(-o|-O|-C|-d|--output|--output-document|--directory|-outfile|-destinationpath)$/i;

/** Các token là nơi lệnh (không kể chuyển hướng >) sẽ ghi vào. */
function writeTargets(name, args) {
  const pos = args.filter((a) => !a.startsWith("-") && a !== ">");
  const out = [];
  if (WRITE_ALL.has(name)) out.push(...pos);
  if (WRITE_LAST.has(name)) {
    if (pos.length) out.push(pos[pos.length - 1]);
    args.forEach((a, i) => {
      if (a === "-t" || a === "--target-directory" || /^-destination$/i.test(a)) out.push(args[i + 1] ?? "");
      if (a.startsWith("--target-directory=")) out.push(a.slice(19));
    });
  }
  // Tải về / giải nén ghi vào nơi chỉ định bằng option: curl -o, wget -O, tar -C, unzip -d, iwr -OutFile.
  if (OUTPUT_OPT_CMDS.has(name)) {
    args.forEach((a, i) => {
      if (OUTPUT_OPT.test(a)) out.push(args[i + 1] ?? "");
      const eq = /^--(output|output-document|directory|one-top-level)=(.+)$/.exec(a);
      if (eq) out.push(eq[2]);
    });
  }
  if ((name === "sed" || name === "perl") && args.some((a) => /^-[a-z]*i/i.test(a) || a === "--in-place"))
    out.push(...pos);
  if (name === "dd") out.push(...args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3)));
  if (name === "git") {
    out.push(...gitSub(args).paths);
    // git diff/log/show --output=<file> ghi ra file bất kỳ.
    args.forEach((a, i) => {
      if (a === "--output") out.push(args[i + 1] ?? "");
      if (a.startsWith("--output=")) out.push(a.slice(9));
    });
  }
  return out;
}

/** Option dài viết tắt mà git chấp nhận (--ha = --hard, --no-verif = --no-verify). */
const longOpt = (flags, full, min) =>
  flags.some((f) => {
    const k = f.split("=")[0];
    return k.startsWith("--") && k.length >= min && full.startsWith(k);
  });

/** Bỏ option toàn cục của git (-C x, -c k=v) để biết lệnh con thật; kèm các đường dẫn lệnh con sẽ ghi đè. */
function gitSub(args) {
  let i = 0;
  const configs = [];
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-c" || args[i] === "--config-env") {
      configs.push(`${args[i]} ${args[i + 1] ?? ""}`);
      i += 2;
    } else if (/^(-C|--git-dir|--work-tree|--namespace|--exec-path)$/.test(args[i])) {
      i += 2;
    } else {
      i++;
    }
  }
  const sub = (args[i] ?? "").toLowerCase();
  const rest = args.slice(i + 1).filter((a) => a !== ">");
  const dashDash = rest.indexOf("--");
  const flags = (dashDash < 0 ? rest : rest.slice(0, dashDash)).filter((a) => a.startsWith("-"));
  const pos = (dashDash < 0 ? rest : rest.slice(0, dashDash)).filter((a) => !a.startsWith("-"));
  const afterDashDash = dashDash < 0 ? [] : rest.slice(dashDash + 1);
  const stagedOnly =
    sub === "restore" &&
    flags.some((f) => f === "-S" || longOpt([f], "--staged", 5)) &&
    !flags.some((f) => f === "-W" || longOpt([f], "--worktree", 4));

  // Đường dẫn bị ghi đè: sau "--", hoặc đối số tồn tại trên đĩa (tên nhánh như infra/x không phải đường dẫn).
  let paths = [];
  if (
    /^(checkout|restore|rm|mv)$/.test(sub) &&
    !stagedOnly &&
    !flags.some((f) => /^-[bB]$|^--orphan/.test(f))
  ) {
    paths = [...afterDashDash, ...pos.filter((p) => existsSync(join(root, p)))];
    if (sub === "restore" || sub === "rm" || sub === "mv") paths.push(...pos);
  }
  return { sub, flags, pos, configs, stagedOnly, paths, all: [...pos, ...afterDashDash] };
}

function currentBranch() {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().toLowerCase() : "";
}

function gitRule(args) {
  const { sub, flags, pos, configs, stagedOnly, all } = gitSub(args);
  const short = (ch) => flags.some((f) => /^-[a-z]+$/i.test(f) && f.includes(ch));
  if (
    configs.some((c) => /core\.hookspath/i.test(c)) ||
    (sub === "config" && args.some((a) => /^core\.hookspath$/i.test(a)))
  )
    return "Không tắt git hook (core.hooksPath).";
  if (configs.some((c) => /^-c alias\.|^--config-env/i.test(c)))
    return "Không định nghĩa alias hoặc cấu hình git ngay trong lệnh.";
  if (longOpt(flags, "--no-verify", 6)) return "Không bỏ qua git hook bằng --no-verify.";
  if (sub === "push") {
    if (
      flags.includes("--force") ||
      longOpt(flags, "--mirror", 5) ||
      short("f") ||
      pos.some((p) => p.startsWith("+"))
    )
      return "Force push bị cấm.";
    const refspecs = pos.slice(1);
    const toMain = refspecs.some((r) => {
      const dst = r
        .split(":")
        .pop()
        .replace(/^refs\/heads\//, "")
        .toLowerCase();
      return MAIN_BRANCHES.has(dst) || dst.includes("*");
    });
    // git push / git push origin HEAD khi đang đứng trên nhánh chính.
    const implicit = refspecs.length === 0 || refspecs.some((r) => /^head$/i.test(r));
    if (toMain || longOpt(flags, "--all", 4) || (implicit && MAIN_BRANCHES.has(currentBranch())))
      return "Không push thẳng lên nhánh chính. Tạo PR.";
  }
  if (sub === "reset" && longOpt(flags, "--hard", 4)) return "reset --hard làm mất thay đổi chưa commit.";
  if (sub === "clean" && (longOpt(flags, "--force", 5) || short("f")))
    return "git clean -f xóa file chưa track.";
  if (/^(checkout|restore|switch)$/.test(sub)) {
    if (!stagedOnly && all.some((p) => [".", "./", "*", "./*", ":/", ":/*"].includes(p)))
      return "Lệnh này bỏ toàn bộ thay đổi đang làm.";
    if (sub !== "restore" && (longOpt(flags, "--force", 5) || short("f")))
      return "checkout -f bỏ thay đổi đang làm.";
  }
  if (sub === "commit" && short("n")) return "Không bỏ qua git hook (commit -n tương đương --no-verify).";
  return null;
}

/** Lý do chặn một lệnh đơn, null nếu cho qua. */
function checkCommand(tokens, depth = 0) {
  // Chuyển hướng ghi ở bất kỳ vị trí nào, kể cả đầu lệnh (> file, &> file).
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i - 1] !== ">") continue;
    const r = protectedReason(tokens[i]);
    if (r) return `Không ghi qua shell: ${r}`;
  }
  if (tokens.some(isEnvFile)) return "Không đọc hoặc chép file .env chứa secret.";

  const t = unwrap(tokens.filter((tok, i) => tok !== ">" && tokens[i - 1] !== ">"));
  if (!t.length) return null;
  const name = base(t[0]);
  const args = t.slice(1);

  // Lệnh trong chuỗi: bash -c '...', pwsh -Command "...", cmd /c, eval "...".
  const inline = name === "eval" ? args.join(" ") : SHELLS.has(name) ? shellInline(args) : null;
  if (inline !== null) {
    if (depth >= 5) return "Lệnh lồng quá sâu.";
    for (const inner of commandsOf(inline)) {
      const r = checkCommand(inner, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const pos = args.filter((a) => !a.startsWith("-") && !(CMD_SLASH_FLAGS.has(name) && /^\/[a-z]$/i.test(a)));

  if (name === "env" || name === "printenv" || (name === "set" && args.length === 0))
    return "Không in biến môi trường (có thể chứa secret).";
  if ((name === "export" || name === "declare" || name === "typeset") && args.every((a) => a.startsWith("-")))
    return "Không in biến môi trường (có thể chứa secret).";
  if (t.some((a) => /^env:/i.test(a))) return "Không liệt kê biến môi trường (PowerShell env:).";

  if (DELETE_CMDS.has(name) && args.some(isRecursive)) {
    if (pos.some(dangerousTarget))
      return "Xóa đệ quy thư mục gốc, home, thư mục cha hoặc toàn bộ thư mục hiện tại.";
    if (tokens.some((tok) => base(tok) === "xargs"))
      return "Xóa đệ quy qua xargs: không biết trước sẽ xóa thư mục nào. Ghi rõ đường dẫn.";
  }
  if (
    name === "find" &&
    args.some((a) => a === "-delete" || a === "-exec" || a === "-execdir") &&
    dangerousTarget(pos[0] ?? ".")
  )
    return "find -delete/-exec trên thư mục gốc, home hoặc thư mục cha.";
  if (
    name === "chmod" &&
    args.some((a) => /^-[a-z]*R/.test(a) || a === "--recursive") &&
    args.some((a) => /^(0?777|a\+rwx|ugo\+rwx)$/.test(a))
  )
    return "Phân quyền 777 đệ quy không an toàn.";

  if (name === "git") {
    const r = gitRule(args);
    if (r) return r;
  }
  if (["docker", "docker-compose", "podman", "dc.sh"].includes(name)) {
    const downVolumes = args.some(
      (a) => (a.startsWith("--volumes") && !/=false$/i.test(a)) || /^-[a-z]*v[a-z]*$/i.test(a),
    );
    if (pos.includes("down") && downVolumes) return "down -v xóa volume dữ liệu.";
    const after = (word) => pos[pos.indexOf(word) + 1] ?? "";
    if (
      (pos.includes("volume") && /^(rm|remove|prune)$/.test(after("volume"))) ||
      (pos.includes("system") && after("system") === "prune")
    )
      return "Lệnh xóa volume/dữ liệu Docker.";
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(name) && pos.includes("publish"))
    return "Không publish package từ phiên AI.";
  if (
    ["npm", "pnpm", "yarn", "bun"].includes(name) &&
    ((pos.includes("pkg") &&
      /^(set|delete)$/.test(pos[pos.indexOf("pkg") + 1] ?? "") &&
      pos.slice(pos.indexOf("pkg") + 2).some((a) => /^scripts(\.|\[|=|$)/.test(a))) ||
      pos.includes("set-script"))
  )
    return "Không sửa script trong package.json qua shell (cổng kiểm tra của dự án).";

  if (!READERS.has(name) && t.some((tok) => /^(deploy|restore-db)\.sh$/.test(base(tok))))
    return "Deploy và khôi phục DB chỉ chạy qua CI hoặc do người vận hành chạy tay.";

  for (const target of writeTargets(name, args)) {
    const r = protectedReason(target);
    if (r) return `Không ghi qua shell: ${r}`;
  }
  return null;
}

// Luật trên cả chuỗi: cần thấy nhiều lệnh cùng lúc (tải rồi chạy) hoặc ngữ cảnh rộng hơn một lệnh.
const WHOLE = [
  [
    /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|\s*(sudo\s+)?((ba|z|da|k)?sh|python3?|node|perl|ruby|pwsh|powershell|iex|invoke-expression)\b/i,
    "Không chạy script tải từ internet qua pipe.",
  ],
  [/<\(\s*(curl|wget)\b/i, "Không chạy script tải từ internet."],
  [
    /\b(iex|invoke-expression)\b.*\b(irm|iwr|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b/i,
    "Không chạy script tải từ internet (PowerShell).",
  ],
  [
    /\b(pwsh|powershell)(\.exe)?\b[^\n]*\s-e(c|nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{16,}/i,
    "Không chạy lệnh PowerShell đã mã hóa base64.",
  ],
  [/--no-verify\b/i, "Không bỏ qua git hook bằng --no-verify."],
  [/\bGIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)\b/, "Không đổi cấu hình git qua biến môi trường."],
  [/\/proc\/[^\s]*\/environ\b/i, "Không đọc biến môi trường của tiến trình."],
  [/getenvironmentvariables/i, "Không liệt kê biến môi trường."],
  [
    /\bdrizzle-kit\s+(push|drop)\b/i,
    "drizzle-kit push/drop bỏ qua lịch sử migration. Dùng pnpm db:generate rồi để CI/deploy áp dụng.",
  ],
  [/\bprisma\s+(migrate\s+reset|db\s+push)\b/i, "Lệnh phá lịch sử migration."],
];
// SQL phá dữ liệu: chỉ xét khi có client SQL trong lệnh (commit message "truncate long titles" không bị chặn nhầm).
const SQL_CLIENT = /\b(psql|mysql|mariadb|sqlite3?|pgcli|duckdb|pg_restore)\b/i;
const SQL_DESTROY = /\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i;

let reason = WHOLE.find(([re]) => re.test(cmd))?.[1] ?? null;
if (!reason && SQL_CLIENT.test(cmd) && SQL_DESTROY.test(cmd))
  reason = "Lệnh SQL phá dữ liệu. Phải đi qua migration có review.";
for (const tokens of reason ? [] : commandsOf(cmd)) {
  reason = checkCommand(tokens);
  if (reason) break;
}
if (reason) {
  block(
    `Lệnh bị chặn bởi .claude/hooks/guard-bash.mjs: ${reason}\nLệnh: ${cmd}\n` +
      "Nếu thật sự cần, dừng lại, giải thích lý do và đề nghị người dùng tự chạy.",
  );
}
pass();
