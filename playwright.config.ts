import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E chạy trên app đã build: API (cổng 3000) + web preview (cổng 4173, proxy /api).
// Local: `pnpm build && pnpm db:migrate && pnpm db:seed -- --demo` rồi `pnpm test:e2e`; hai server tự khởi động.
// CI khởi động sẵn hai server (để in log khi lỗi), Playwright dùng lại. Ở máy dev thì KHÔNG dùng lại: API của
// `pnpm dev` kiểm Origin theo cổng 5173 nên mọi request ghi từ web preview (4173) sẽ bị 403. Tắt `pnpm dev` trước.
if (existsSync(".env")) process.loadEnvFile(".env"); // SEED_ADMIN_PASSWORD, DATABASE_URL... (không ghi đè biến đã có)

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  // Đăng nhập mỗi tài khoản một lần (auth.setup.ts) rồi dùng lại phiên: giới hạn 10 lần đăng nhập/phút mỗi IP là chốt
  // bảo mật, không nới cho test.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  // Chạy trên môi trường có sẵn (E2E_BASE_URL) thì không khởi động gì.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node --enable-source-maps apps/api/dist/main.js",
          url: "http://localhost:3000/api/health/live",
          reuseExistingServer: Boolean(process.env.CI),
          timeout: 60_000,
          // API kiểm Origin chống CSRF: phải trùng địa chỉ web preview.
          env: { APP_ORIGIN: baseURL },
        },
        {
          // Worker chạy job xuất file. Không có cổng HTTP: chờ dòng log sẵn sàng. Luôn tự khởi động (kể cả CI).
          command: "node --enable-source-maps apps/worker/dist/main.js",
          wait: { stdout: /Worker đã sẵn sàng/ },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: "pnpm --filter @app/web exec vite preview --port 4173 --strictPort",
          url: baseURL,
          reuseExistingServer: Boolean(process.env.CI),
          timeout: 60_000,
        },
      ],
});
