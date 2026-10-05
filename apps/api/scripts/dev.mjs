// Chạy API ở chế độ dev, đa nền tảng (Windows/macOS/Linux):
// tsc --watch biên dịch liên tục, node --watch tự khởi động lại khi dist thay đổi.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const args = ["-p", "tsconfig.build.json"];

const first = spawnSync(process.execPath, [tsc, ...args], { stdio: "inherit" });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, ...args, "--watch", "--preserveWatchOutput"], { stdio: "inherit" }),
  spawn(process.execPath, ["--watch-path=dist", "--enable-source-maps", "dist/main.js"], {
    stdio: "inherit",
  }),
];
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) => c.on("exit", (code) => code && code !== 0 && process.exit(code)));
