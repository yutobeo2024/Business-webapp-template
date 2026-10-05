import { describe, expect, it } from "vitest";
import { formatPhone, optionalPhoneSchema, vnPhoneSchema } from "./notifications.js";

describe("số điện thoại", () => {
  it("chuẩn hóa mọi cách viết thường gặp về 84xxxxxxxxx", () => {
    for (const v of ["0912345678", "0912 345 678", "+84 912.345.678", "84912345678", "(091) 234-5678"]) {
      expect(vnPhoneSchema.parse(v), v).toBe("84912345678");
    }
  });
  it("từ chối số bàn, thiếu/thừa số, ký tự lạ", () => {
    for (const v of ["0243 826 1234", "091234567", "09123456789", "0912abc678", "84212345678", ""]) {
      expect(vnPhoneSchema.safeParse(v).success, v).toBe(false);
    }
  });
  it("ô để trống là không có số; hiển thị lại dạng 0xxx xxx xxx", () => {
    expect(optionalPhoneSchema.parse("")).toBeNull();
    expect(optionalPhoneSchema.parse(null)).toBeNull();
    expect(formatPhone("84912345678")).toBe("0912 345 678");
  });
});
