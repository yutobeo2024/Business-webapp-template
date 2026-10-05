/** Mẫu in phiếu đề nghị (module MẪU, xóa cùng mẫu). */
import { describe, expect, it } from "vitest";
import { purchaseRequestHtml } from "../exports/templates/purchase-request.js";

describe("mẫu in phiếu đề nghị", () => {
  it("mẫu in phiếu: dữ liệu người dùng nhập không thành thẻ HTML", () => {
    const doc = purchaseRequestHtml({
      pr: {
        id: "x",
        code: "PR-2026-000001",
        title: "<script>alert(1)</script>",
        departmentId: "d",
        requesterId: "u",
        status: "DRAFT",
        totalAmount: 1_250_000,
        items: [{ name: "</td><img src=x>", quantity: 1, unitPrice: 1_250_000 }],
        note: null,
        rejectReason: null,
        version: 1,
        deletedAt: null,
        createdAt: new Date("2026-01-31T17:30:00Z"),
        updatedAt: new Date("2026-01-31T17:30:00Z"),
      },
      requesterName: "Nguyễn Văn A",
      departmentName: "Kinh doanh",
      printedAt: new Date("2026-02-01T01:00:00Z"),
    }).value;
    expect(doc).not.toContain("<script>");
    expect(doc).not.toContain("<img");
    expect(doc).toContain("&lt;script&gt;");
    expect(doc).toContain("01/02/2026"); // ngày theo giờ Việt Nam
    expect(doc).toMatch(/1\.250\.000\s₫/);
  });
});
