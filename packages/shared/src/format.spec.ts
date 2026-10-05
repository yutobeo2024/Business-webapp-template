import { describe, expect, it } from "vitest";
import { formatDateTime, formatVnd } from "./format.js";

describe("format", () => {
  it("định dạng tiền VND", () => expect(formatVnd(1_250_000).replace(/\s/g, " ")).toBe("1.250.000 ₫"));
  it("định dạng ngày giờ theo múi giờ Việt Nam: ngày trước giờ, 24 giờ", () => {
    expect(formatDateTime("2026-01-31T17:30:00.000Z")).toBe("01/02/2026 00:30");
    expect(formatDateTime(new Date("2026-10-04T08:05:00Z"))).toBe("04/10/2026 15:05");
  });
});
