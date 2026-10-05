/** Múi giờ nghiệp vụ. Dữ liệu lưu UTC; mọi thứ phụ thuộc "ngày/năm theo lịch" (mã chứng từ, báo cáo) tính theo múi này. */
export const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Năm theo giờ Việt Nam. Server chạy UTC: 00:00-06:59 ngày 01/01 giờ Việt Nam vẫn là năm cũ nếu dùng getFullYear(). */
export function businessYear(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, year: "numeric" }).format(date),
  );
}
