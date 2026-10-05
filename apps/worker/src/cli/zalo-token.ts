/**
 * Nạp refresh token Zalo OA ban đầu (lấy từ trang quản lý ứng dụng Zalo for Developers), lưu MÃ HÓA vào DB.
 * Đọc token từ stdin để không lọt vào lịch sử shell:
 *   docker compose run --rm -T worker node dist/cli/zalo-token.js < token.txt
 * Từ đó worker tự làm mới; cần chạy lại khi token bị thu hồi hoặc hết hạn (runbook notifications).
 */
import { createDb } from "@app/db";
import { parseEncryptionKey } from "@app/server";
import { ZaloZnsSender } from "../notifications/zalo.js";

const url = process.env.DATABASE_URL;
const keyText = process.env.APP_ENCRYPTION_KEY;
if (!url || !keyText) {
  console.error("Thiếu DATABASE_URL hoặc APP_ENCRYPTION_KEY");
  process.exit(1);
}
const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const token = Buffer.concat(chunks).toString("utf8").trim();
if (!token) {
  console.error("Không đọc được token từ stdin");
  process.exit(1);
}
const handle = createDb(url, { max: 1, appName: "zalo-token" });
try {
  await ZaloZnsSender.storeRefreshToken(handle.db, token, parseEncryptionKey(keyText));
  console.warn("[zalo-token] Đã lưu refresh token (mã hóa). Worker sẽ lấy access token ở lần gửi đầu.");
} finally {
  await handle.close();
}
