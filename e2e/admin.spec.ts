/**
 * E2E LÕI (giữ trong mọi dự án, chạy được sau `pnpm sample:remove`): quản trị người dùng/vai trò, nhập Excel kèm thông
 * báo kết quả, xuất danh sách người dùng.
 */
import ExcelJS from "exceljs";
import { E2E_PASSWORD, expect, test } from "./users.js";

test("quản trị: tạo vai trò và người dùng; người mới bị bắt đổi mật khẩu rồi chỉ thấy đúng mục được phép", async ({
  pageAs,
  browser,
}) => {
  const stamp = Date.now();
  const roleName = `Phụ trách phòng ban ${stamp}`;
  const email = `pb.${stamp}@example.com`;
  const temp = `tam-${stamp}`;
  const newPassword = `moi-${stamp}-abc`;
  const page = await pageAs("admin");
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Người dùng" })).toBeVisible();

  // Vai trò mới chỉ có quyền quản lý phòng ban.
  await nav.getByRole("link", { name: "Vai trò" }).click();
  await page.getByRole("button", { name: "Thêm vai trò" }).click();
  const roleDialog = page.getByRole("dialog");
  await roleDialog.getByLabel("Tên vai trò").fill(roleName);
  await roleDialog.getByLabel("Quản lý phòng ban").check();
  await roleDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("row", { name: new RegExp(roleName) })).toBeVisible();

  // Người dùng mới, mật khẩu tạm do quản trị viên đặt.
  await nav.getByRole("link", { name: "Người dùng" }).click();
  await page.getByRole("button", { name: "Thêm người dùng" }).click();
  const userDialog = page.getByRole("dialog");
  await userDialog.getByLabel("Email").fill(email);
  await userDialog.getByLabel("Mật khẩu tạm").fill(temp);
  await userDialog.getByLabel("Họ tên").fill("Phụ Trách Phòng Ban");
  await userDialog.getByLabel(roleName).check();
  await userDialog.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(userDialog.getByText(temp)).toBeVisible();
  await userDialog.getByRole("button", { name: "Đóng" }).click();
  await page.getByLabel("Tìm người dùng").fill(email);
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Đang dùng mật khẩu tạm");

  // Người mới (trình duyệt riêng): bắt đổi mật khẩu trước khi vào ứng dụng.
  const context = await browser.newContext();
  try {
    const user = await context.newPage();
    await user.goto("/");
    await user.getByLabel("Email").fill(email);
    await user.getByLabel("Mật khẩu").fill(temp);
    await user.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(user.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
    await user.getByLabel("Mật khẩu tạm").fill(temp);
    await user.getByLabel("Mật khẩu mới").fill(newPassword);
    await user.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
    await expect(user.getByRole("heading", { name: /Xin chào/ })).toBeVisible();
    await expect(user.getByRole("navigation").getByRole("link", { name: "Phòng ban" })).toBeVisible();
    await expect(user.getByRole("navigation").getByRole("link", { name: "Người dùng" })).toHaveCount(0);
  } finally {
    await context.close();
  }
  expect(E2E_PASSWORD).not.toBe("");
});

async function departmentsXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Phòng ban");
  ws.addRow(["Mã phòng ban", "Tên phòng ban"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("nhập phòng ban từ Excel: tệp có lỗi bị chặn, tệp đúng nhập xong, có thông báo kết quả", async ({
  pageAs,
}) => {
  const code = `E2E${Date.now() % 1_000_000}`;
  const page = await pageAs("admin");
  await page.goto("/admin/departments");
  await page.getByRole("button", { name: "Nhập từ Excel" }).click();
  const dialog = page.getByRole("dialog");

  // Tệp mẫu tải về được.
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "tệp mẫu" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("mau-nhap-departments.xlsx");

  // Có dòng sai: không nhập gì, báo đúng dòng.
  await dialog.getByLabel("Chọn tệp Excel để nhập").setInputFiles({
    name: "co-loi.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await departmentsXlsx([
      [code, "Phòng E2E"],
      ["sai mã!", "Phòng lỗi"],
    ]),
  });
  await expect(dialog).toContainText("Có lỗi", { timeout: 20_000 });
  await expect(dialog.getByRole("row", { name: /3 Mã phòng ban/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Xác nhận nhập/ })).toHaveCount(0);

  // Tệp đúng: xem trước rồi xác nhận.
  await dialog.getByLabel("Chọn tệp Excel để nhập").setInputFiles({
    name: "dung.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await departmentsXlsx([[code, "Phòng E2E"]]),
  });
  await dialog.getByRole("button", { name: "Xác nhận nhập 1 dòng" }).click({ timeout: 20_000 });
  await expect(dialog.getByRole("status")).toHaveText("Đã nhập 1 dòng.", { timeout: 20_000 });
  await dialog.getByRole("button", { name: "Đóng" }).click();
  await page.getByLabel("Tìm phòng ban").fill(code);
  await expect(page.getByRole("row", { name: new RegExp(code) })).toBeVisible();

  // Thông báo kết quả nhập (worker tạo sau khi ghi xong): mở từ trang Thông báo, dẫn về trang Phòng ban.
  await expect(async () => {
    await page.goto("/notifications");
    await expect(page.getByRole("button", { name: /Nhập phòng ban xong/ }).first()).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /Nhập phòng ban xong/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/departments/);
});

test("xuất Excel danh sách người dùng chạy nền rồi tải về ở Tệp đã xuất", async ({ pageAs }) => {
  const page = await pageAs("admin");
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Xuất Excel" }).click();
  await page.getByRole("link", { name: "Xem ở Tệp đã xuất" }).click();
  const row = page.getByRole("row", { name: /Danh sách người dùng \(Excel\)/ }).first();
  const link = row.getByRole("link", { name: /^Tải nguoi-dung-.*\.xlsx$/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^nguoi-dung-\d{8}-\d{4}\.xlsx$/);
});
