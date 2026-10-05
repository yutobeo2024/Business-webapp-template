/** Định dạng hiển thị dùng chung cho web và tệp xuất (Excel, PDF): cùng một cách viết tiền và giờ ở mọi nơi. */
import { BUSINESS_TIMEZONE } from "./time.js";

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
// Dựng từng phần rồi tự ghép: thứ tự mặc định của Intl vi-VN là "HH:mm dd/MM/yyyy" (giờ trước ngày) và có thể đổi theo
// phiên bản ICU của Node/trình duyệt. Web, Excel, PDF phải hiện giống nhau.
const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 1250000 -> "1.250.000 ₫" */
export const formatVnd = (amount: number): string => vnd.format(amount);
/** ISO -> "dd/MM/yyyy HH:mm" theo giờ Việt Nam */
export function formatDateTime(value: string | Date): string {
  const p = Object.fromEntries(dateTime.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
/** 1536 -> "1,5 KB"; 2400000 -> "2,3 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${decimal.format(bytes / 1024)} KB`;
  return `${decimal.format(bytes / 1024 / 1024)} MB`;
}

const date = new Intl.DateTimeFormat("vi-VN", {
  timeZone: BUSINESS_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
/** ISO hoặc Date -> "dd/MM/yyyy" theo giờ Việt Nam */
export const formatDate = (value: string | Date): string => date.format(new Date(value));
