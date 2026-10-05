import { defineConfig } from "vitest/config";
import { useTestEnv } from "../api/test/test-env.js";

// Tích hợp: PostgreSQL + Chromium THẬT. Dùng chung global-setup của api (kiểm DB tên *_test, Redis DB riêng, chạy migration).
useTestEnv();

export default defineConfig({
  test: {
    include: ["src/**/*.int.spec.ts"],
    environment: "node",
    globalSetup: ["../api/test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
