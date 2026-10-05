/** E2E của module MẪU phiếu đề nghị (xóa cùng mẫu bởi `pnpm sample:remove`). Tài khoản từ `pnpm db:seed -- --demo`. */
import { expect, test } from "./users.js";

/** Mở danh sách phiếu bằng phiên đã lưu của người dùng. */
async function openList(page: import("@playwright/test").Page) {
  await page.goto("/purchase-requests");
  await expect(page.getByRole("heading", { name: "Phiếu đề nghị mua hàng" })).toBeVisible();
}

test("AC-01: nhân viên lập và gửi phiếu, trưởng phòng duyệt", async ({ pageAs }) => {
  const title = `Mua giấy in E2E ${Date.now()}`;
  const page = await pageAs("staff");
  await openList(page);
  await page.getByRole("button", { name: "Lập phiếu" }).click();
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByPlaceholder("Tên hàng").fill("Giấy A4");
  await page.locator('input[name="items.0.unitPrice"]').fill("90000");
  await page.getByRole("button", { name: "Lưu nháp" }).click();

  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("Nháp");
  await row.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(row).toContainText("Chờ trưởng phòng duyệt");

  const manager = await pageAs("manager");
  await openList(manager);
  const managerRow = manager.getByRole("row", { name: new RegExp(title) });
  await managerRow.getByRole("button", { name: "Trưởng phòng duyệt" }).click();
  // Hộp thoại xác nhận của ứng dụng (thẻ <dialog>), không phải window.confirm.
  await manager.getByRole("dialog").getByRole("button", { name: "Trưởng phòng duyệt" }).click();
  await expect(managerRow).toContainText("Đã duyệt");
});

test("danh sách: tìm theo mã giữ trên URL, tải lại trang vẫn còn bộ lọc", async ({ pageAs }) => {
  const page = await pageAs("staff");
  await openList(page);
  await page.getByLabel("Tìm kiếm phiếu").fill("khong-co-phieu-nao-khop");
  await expect(page.getByText("Không có phiếu nào khớp bộ lọc.")).toBeVisible();
  await expect(page).toHaveURL(/q=khong-co-phieu-nao-khop/);
  await page.reload();
  await expect(page.getByLabel("Tìm kiếm phiếu")).toHaveValue("khong-co-phieu-nao-khop");
  await expect(page.getByText("Không có phiếu nào khớp bộ lọc.")).toBeVisible();
});

test("BR-09: nhân viên đính kèm PDF vào phiếu nháp và tải lại được", async ({ pageAs }) => {
  const title = `Phiếu có đính kèm E2E ${Date.now()}`;
  const page = await pageAs("staff");
  await openList(page);
  await page.getByRole("button", { name: "Lập phiếu" }).click();
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByPlaceholder("Tên hàng").fill("Mực in");
  await page.locator('input[name="items.0.unitPrice"]').fill("350000");
  await page.getByRole("button", { name: "Lưu nháp" }).click();

  const row = page.getByRole("row", { name: new RegExp(title) });
  await row.getByRole("button", { name: "Đính kèm" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Chưa có tệp đính kèm.");
  await dialog.getByLabel("Chọn tệp đính kèm").setInputFiles({
    name: "Báo giá mực in.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  const link = dialog.getByRole("link", { name: "Báo giá mực in.pdf" });
  await expect(link).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Báo giá mực in.pdf");

  // Tệp chạy được đổi đuôi .pdf bị từ chối, có thông báo rõ.
  await dialog.getByLabel("Chọn tệp đính kèm").setInputFiles({
    name: "hoa-don.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 0x90)]),
  });
  await expect(dialog.getByRole("alert")).toContainText("Loại tệp không được phép");
});

test("xuất Excel danh sách phiếu chạy nền rồi tải về ở Tệp đã xuất", async ({ pageAs }) => {
  const page = await pageAs("manager");
  await openList(page);
  await page.getByRole("button", { name: "Xuất Excel" }).click();
  await page.getByRole("link", { name: "Xem ở Tệp đã xuất" }).click();
  await expect(page.getByRole("heading", { name: "Tệp đã xuất" })).toBeVisible();

  // Trang tự cập nhật khi worker tạo xong.
  const row = page.getByRole("row", { name: /Danh sách phiếu đề nghị \(Excel\)/ }).first();
  const link = row.getByRole("link", { name: /^Tải phieu-de-nghi-.*\.xlsx$/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("Xong");

  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^phieu-de-nghi-\d{8}-\d{4}\.xlsx$/);
});

test("thông báo: gửi phiếu thì trưởng phòng thấy chuông, mở thông báo đi tới phiếu", async ({ pageAs }) => {
  const title = `Phiếu báo trưởng phòng E2E ${Date.now()}`;
  const page = await pageAs("staff");
  await openList(page);
  await page.getByRole("button", { name: "Lập phiếu" }).click();
  await page.getByLabel("Tiêu đề").fill(title);
  await page.getByPlaceholder("Tên hàng").fill("Bút bi");
  await page.locator('input[name="items.0.unitPrice"]').fill("5000");
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  const row = page.getByRole("row", { name: new RegExp(title) });
  await row.getByRole("button", { name: "Gửi duyệt" }).click();
  await expect(row).toContainText("Chờ trưởng phòng duyệt");
  const code = (await row.getByRole("cell").first().innerText()).trim();

  const manager = await pageAs("manager");
  // Worker tạo thông báo sau khi phiếu đổi trạng thái; chuông tải lại khi mở trang.
  await expect(async () => {
    await manager.goto("/");
    await expect(manager.getByRole("link", { name: /Thông báo \(\d+ chưa đọc\)/ })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await manager.goto("/notifications");
  await manager.getByRole("button", { name: new RegExp(`Phiếu ${code} chờ bạn duyệt`) }).click();
  await expect(manager.getByRole("heading", { name: "Phiếu đề nghị mua hàng" })).toBeVisible();
  await expect(manager.getByRole("row", { name: new RegExp(title) })).toBeVisible();
  await expect(manager).toHaveURL(new RegExp(`q=${code}`));
});
