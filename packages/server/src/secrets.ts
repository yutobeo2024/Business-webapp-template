/**
 * Mã hóa bí mật lưu trong DB (token Zalo...) bằng AES-256-GCM, khóa `APP_ENCRYPTION_KEY` (32 byte, base64) nằm ngoài DB:
 * lộ bản sao lưu DB không lộ token. GCM phát hiện dữ liệu bị sửa (giải mã báo lỗi thay vì ra rác).
 * Định dạng: "v1:" + base64(iv 12 byte | tag 16 byte | bản mã). "v1" để sau này đổi thuật toán hoặc xoay khóa.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY phải là 32 byte dạng base64 (sinh bằng: openssl rand -base64 32)");
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

export function decryptSecret(sealed: string, key: Buffer): string {
  if (!sealed.startsWith("v1:")) throw new Error("Bí mật mã hóa sai định dạng");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
