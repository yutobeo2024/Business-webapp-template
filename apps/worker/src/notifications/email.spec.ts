import { describe, expect, it } from "vitest";
import { absoluteLink, renderEmail } from "./email.js";

const n = {
  type: "import.finished" as const,
  title: "Kết quả kiểm tệp nhập phòng ban",
  body: `Mua <script>alert(1)</script>. Lý do: "thiếu" & sai`,
  link: "/admin/departments?q=KD",
  data: {} as never,
  trackingId: "t",
};

describe("email thông báo", () => {
  it("escape nội dung người dùng nhập; có bản text; liên kết tuyệt đối theo APP_ORIGIN", () => {
    const m = renderEmail(n, "https://app.congty.vn");
    expect(m.subject).toBe(n.title);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain('href="https://app.congty.vn/admin/departments?q=KD"');
    expect(m.text).toContain("Mua <script>alert(1)</script>");
    expect(m.text).toContain("https://app.congty.vn/account/notifications");
  });

  it("chỉ nhận đường dẫn trong app: không dẫn ra trang ngoài", () => {
    for (const bad of ["//evil.com/x", "https://evil.com", "/\\evil.com", "javascript:alert(1)", null]) {
      expect(absoluteLink("https://app.congty.vn", bad), String(bad)).toBeNull();
    }
    expect(renderEmail({ ...n, link: "//evil.com" }, "https://app.congty.vn").html).not.toContain("evil.com");
  });
});
