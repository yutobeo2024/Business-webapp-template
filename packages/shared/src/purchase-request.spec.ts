import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidVnd, MAX_VND } from "./money.js";
import {
  calcTotal,
  createPurchaseRequestSchema,
  transitionPurchaseRequestSchema,
} from "./purchase-request.js";

describe("createPurchaseRequestSchema", () => {
  it("chấp nhận phiếu hợp lệ", () => {
    const r = createPurchaseRequestSchema.safeParse({
      title: "Mua máy in phòng kế toán",
      items: [{ name: "Máy in", quantity: 1, unitPrice: 5_000_000 }],
    });
    expect(r.success).toBe(true);
  });

  it("từ chối số tiền lẻ (không phải số nguyên VND)", () => {
    const r = createPurchaseRequestSchema.safeParse({
      title: "Mua máy in",
      items: [{ name: "Máy in", quantity: 1, unitPrice: 1000.5 }],
    });
    expect(r.success).toBe(false);
  });

  it("từ chối tổng tiền vượt giới hạn dù từng đơn giá hợp lệ", () => {
    const parse = (quantity: number, unitPrice: number) =>
      createPurchaseRequestSchema.safeParse({
        title: "Mua hàng số lớn",
        items: [{ name: "A", quantity, unitPrice }],
      }).success;
    expect(parse(2, MAX_VND)).toBe(false);
    expect(parse(1_000_000, MAX_VND)).toBe(false);
    expect(parse(1, MAX_VND + 1)).toBe(false);
    expect(parse(1, MAX_VND)).toBe(true);
  });

  it("schema vẫn mở rộng được bằng .extend() (controller sửa phiếu dùng)", () => {
    expect(() => createPurchaseRequestSchema.extend({ version: z.number() })).not.toThrow();
  });

  it("ô số bỏ trống (NaN) báo lỗi tiếng Việt, không phải thông báo mặc định tiếng Anh", () => {
    const r = createPurchaseRequestSchema.safeParse({
      title: "Mua máy in",
      items: [{ name: "Máy in", quantity: Number.NaN, unitPrice: Number.NaN }],
    });
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toEqual(["Nhập số lượng", "Nhập số tiền"]);
  });

  it("từ chối phiếu không có dòng hàng", () => {
    expect(createPurchaseRequestSchema.safeParse({ title: "Mua máy in", items: [] }).success).toBe(false);
  });
});

describe("transitionPurchaseRequestSchema", () => {
  it("BR-04: từ chối bắt buộc có lý do tối thiểu 10 ký tự", () => {
    expect(transitionPurchaseRequestSchema.safeParse({ event: "REJECT", version: 1 }).success).toBe(false);
    expect(
      transitionPurchaseRequestSchema.safeParse({ event: "REJECT", version: 1, reason: "Thiếu báo giá" })
        .success,
    ).toBe(true);
  });
});

describe("isValidVnd", () => {
  it("chỉ nhận số nguyên an toàn trong [0, MAX_VND]", () => {
    expect(isValidVnd(0)).toBe(true);
    expect(isValidVnd(MAX_VND)).toBe(true);
    expect(isValidVnd(MAX_VND + 1)).toBe(false);
    expect(isValidVnd(9e21)).toBe(false);
    expect(isValidVnd(-1)).toBe(false);
    expect(isValidVnd(1.5)).toBe(false);
  });
});

describe("calcTotal", () => {
  it("cộng đúng thành tiền", () => {
    expect(
      calcTotal([
        { name: "A", quantity: 2, unitPrice: 1_500_000 },
        { name: "B", quantity: 3, unitPrice: 200_000 },
      ]),
    ).toBe(3_600_000);
  });
});
