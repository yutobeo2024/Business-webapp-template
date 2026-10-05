import { z } from "zod";

/**
 * Trần cho MỌI số tiền VND (đơn giá, thành tiền, tổng): 1 triệu tỷ đồng.
 * Nhỏ hơn 2^53 nên số nguyên kiểu number luôn chính xác và cột bigint (mode "number") không lưu sai.
 */
export const MAX_VND = 1_000_000_000_000_000;

/** Số tiền VND nhập vào: số nguyên, không âm, không vượt MAX_VND. Dùng cho mọi trường tiền. */
export const vndSchema = z
  .number("Nhập số tiền")
  .int("Số tiền phải là số nguyên (VND)")
  .min(0, "Số tiền không được âm")
  .max(MAX_VND, "Số tiền vượt giới hạn cho phép");

/**
 * Kiểm một số tiền ĐÃ TÍNH (tổng, số lượng × đơn giá). Từng ô hợp lệ chưa đủ: tổng vẫn có thể vượt 2^53
 * (mất chính xác, lưu sai tiền) hoặc thành "9e+21" (PostgreSQL từ chối, lỗi 500).
 */
export function isValidVnd(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_VND;
}
