/**
 * Kiểm tệp .xlsx (thực chất là zip) TRƯỚC khi thư viện Excel mở nó: tệp 10 MB có thể nở thành hàng GB (zip bomb) và làm
 * sập worker. Không tin kích thước khai báo trong tệp (kẻ tấn công khai báo nhỏ hơn thật): giải nén THẬT từng mục với trần
 * byte (`maxOutputLength` của zlib dừng ngay khi vượt), cộng dồn kích thước thật. Tệp qua được bước này thì khi thư viện
 * giải nén lại cũng chỉ ra đúng chừng đó byte.
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipLimits {
  /** Tổng kích thước sau giải nén tối đa (byte), đo bằng giải nén thật. */
  maxUncompressed: number;
  /** Tỷ lệ nén tối đa (sau / trước), tệp Excel bình thường dưới 30. */
  maxRatio: number;
  maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxUncompressed: 200 * 1024 * 1024,
  maxRatio: 200,
  maxEntries: 5000,
};

/** Trả câu lỗi tiếng Việt nếu tệp không an toàn để mở, null nếu ổn. */
export function checkZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): string | null {
  // Bản ghi kết thúc nằm trong 22 + 65535 byte cuối (có thể có chú thích).
  const from = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "Tệp không phải Excel hợp lệ (.xlsx)";
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) return "Tệp quá lớn hoặc dạng ZIP64, không hỗ trợ";
  if (entries > limits.maxEntries) return "Tệp có quá nhiều thành phần";

  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDIR_SIG) return "Tệp Excel bị hỏng";
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const local = buf.readUInt32LE(offset + 42);
    if (compressed === 0xffffffff || local === 0xffffffff) return "Tệp dạng ZIP64, không hỗ trợ";
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL_SIG) return "Tệp Excel bị hỏng";
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) return "Tệp Excel bị hỏng";
    const data = buf.subarray(start, start + compressed);

    const budget = limits.maxUncompressed - total;
    if (method === 0) {
      total += data.length; // lưu không nén
    } else if (method === 8) {
      try {
        // Vượt trần thì zlib dừng và ném lỗi ERR_BUFFER_TOO_LARGE, không cấp phát thêm.
        total += inflateRawSync(data, { maxOutputLength: Math.max(budget, 1) }).length;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
          ? "Tệp sau giải nén quá lớn"
          : "Tệp Excel bị hỏng";
      }
    } else {
      return "Tệp dùng kiểu nén không hỗ trợ";
    }
    if (total > limits.maxUncompressed) return "Tệp sau giải nén quá lớn";
    offset +=
      46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  if (total / Math.max(buf.length, 1) > limits.maxRatio) return "Tệp có tỷ lệ nén bất thường";
  return null;
}
