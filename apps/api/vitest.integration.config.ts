import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
import { useTestEnv } from "./test/test-env.js";

// Test tích hợp chạy trên PostgreSQL + Redis THẬT (DATABASE_URL, REDIS_URL). Không mock luồng ghi.
useTestEnv();

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.int.spec.ts", "test/**/*.int.spec.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
