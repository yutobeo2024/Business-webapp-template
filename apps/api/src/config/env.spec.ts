import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = { DATABASE_URL: "postgresql://x", REDIS_URL: "redis://x" };

describe("loadEnv", () => {
  it("APP_ORIGIN được chuẩn hóa về origin (bỏ dấu / cuối)", () => {
    expect(loadEnv({ ...base, APP_ORIGIN: "https://app.congty.vn/" }).APP_ORIGIN).toBe(
      "https://app.congty.vn",
    );
  });

  it("APP_ORIGIN thiếu http/https bị từ chối, không âm thầm thành chuỗi null", () => {
    expect(() => loadEnv({ ...base, APP_ORIGIN: "localhost:5173" })).toThrow(/APP_ORIGIN/);
    expect(() => loadEnv({ ...base, APP_ORIGIN: "ftp://app.congty.vn" })).toThrow(/APP_ORIGIN/);
  });
});
