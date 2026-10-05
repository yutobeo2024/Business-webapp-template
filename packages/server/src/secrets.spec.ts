import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./secrets.js";

const key = randomBytes(32);

describe("mã hóa bí mật", () => {
  it("giải mã lại đúng; mỗi lần mã hóa ra bản khác nhau; không chứa bản rõ", () => {
    const a = encryptSecret("token-zalo-bí-mật", key);
    const b = encryptSecret("token-zalo-bí-mật", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("token");
    expect(decryptSecret(a, key)).toBe("token-zalo-bí-mật");
  });

  it("sai khóa hoặc dữ liệu bị sửa: báo lỗi, không ra rác", () => {
    const sealed = encryptSecret("abc", key);
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
    expect(() => decryptSecret("abc", key)).toThrow(/định dạng/);
  });

  it("khóa phải đúng 32 byte", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 byte/);
    expect(parseEncryptionKey(key.toString("base64"))).toHaveLength(32);
  });
});
