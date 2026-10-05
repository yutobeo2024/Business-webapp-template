// Bỏ ký tự dễ nhầm khi đọc cho người khác qua điện thoại (0/O, 1/l/I).
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Mật khẩu tạm ngẫu nhiên (crypto), đủ dài cho chính sách mật khẩu; người nhận bắt buộc đổi ở lần đăng nhập đầu. */
export function generateTemporaryPassword(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
