import { expect, test as setup } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS, type E2EUser, storageStatePath } from "./users.js";

/**
 * Đăng nhập MỖI tài khoản đúng một lần cho cả lượt chạy rồi lưu phiên (cookie) để các test dùng lại. Đăng nhập bị giới
 * hạn 10 lần/phút mỗi IP (chốt bảo mật, không nới cho test): mỗi test tự đăng nhập thì cả bộ E2E chạm giới hạn.
 */
for (const [key, email] of Object.entries(E2E_USERS) as [E2EUser, string][]) {
  setup(`đăng nhập ${key}`, async ({ request, baseURL }) => {
    expect(email && E2E_PASSWORD, "Thiếu SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (xem .env)").toBeTruthy();
    const res = await request.post("/api/auth/login", {
      // OriginGuard chống CSRF: request ghi phải có Origin đúng địa chỉ app.
      headers: { Origin: new URL(baseURL!).origin },
      data: { email, password: E2E_PASSWORD },
    });
    expect(res.status(), `đăng nhập ${email}`).toBe(200);
    await request.storageState({ path: storageStatePath(key) });
  });
}
