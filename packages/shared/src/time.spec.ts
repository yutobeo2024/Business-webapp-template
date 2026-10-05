import { describe, expect, it } from "vitest";
import { businessYear } from "./time.js";

describe("businessYear", () => {
  it("rạng sáng 01/01 giờ Việt Nam đã là năm mới dù UTC còn năm cũ", () => {
    expect(businessYear(new Date("2026-12-31T17:30:00Z"))).toBe(2027);
    expect(businessYear(new Date("2026-12-31T16:59:00Z"))).toBe(2026);
  });
});
