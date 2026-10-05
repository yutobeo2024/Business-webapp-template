import { test as base, type BrowserContext, type Page } from "@playwright/test";

/**
 * Tài khoản dùng chung cho E2E. Quản trị viên từ SEED_ADMIN_EMAIL (`pnpm db:seed`); tài khoản demo của module từ
 * `pnpm db:seed -- --demo`. Module mới thêm tài khoản demo của mình vào đây.
 */
export const E2E_USERS = {
  admin: process.env.SEED_ADMIN_EMAIL ?? "",
  // sample:begin
  staff: "nhanvien@example.com",
  manager: "truongphong@example.com",
  // sample:end
} as const;
export type E2EUser = keyof typeof E2E_USERS;
export const E2E_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

/** Phiên đăng nhập đã lưu bởi auth.setup.ts (thư mục không đưa vào git). */
export const storageStatePath = (user: E2EUser): string => `e2e/.auth/${user}.json`;

/**
 * `pageAs(user)`: trang mới đã đăng nhập sẵn bằng phiên đã lưu (mỗi người một browser context riêng). Test dùng phiên
 * đã lưu KHÔNG được bấm "Đăng xuất": đăng xuất thu hồi phiên phía server, test sau dùng lại phiên đó sẽ hỏng.
 */
export const test = base.extend<{ pageAs: (user: E2EUser) => Promise<Page> }>({
  pageAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (user) => {
      const context = await browser.newContext({ storageState: storageStatePath(user) });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});
export { expect } from "@playwright/test";
