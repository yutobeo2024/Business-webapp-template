import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = { DATABASE_URL: "postgresql://x", REDIS_URL: "redis://x" };

describe("cấu hình worker", () => {
  it("mặc định: không email, không Zalo; mẫu ZNS rỗng", () => {
    const env = loadEnv(base);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.ZALO_ENABLED).toBe(false);
    expect(env.ZALO_TEMPLATES).toEqual({});
  });

  it("bật Zalo mà thiếu app id, secret, khóa mã hóa: không khởi động", () => {
    expect(() => loadEnv({ ...base, ZALO_ENABLED: "true" })).toThrow(
      /ZALO_APP_ID.*ZALO_SECRET_KEY.*APP_ENCRYPTION_KEY/,
    );
  });

  it("ZALO_TEMPLATES phải là JSON hợp lệ", () => {
    expect(loadEnv({ ...base, ZALO_TEMPLATES: '{"import.finished":"1"}' }).ZALO_TEMPLATES).toEqual({
      "import.finished": "1",
    });
    expect(() => loadEnv({ ...base, ZALO_TEMPLATES: "import.finished=1" })).toThrow(/ZALO_TEMPLATES/);
  });
});
