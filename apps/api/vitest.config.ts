import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC để giữ decorator metadata cho DI của NestJS (esbuild mặc định không hỗ trợ).
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.int.spec.ts"],
    environment: "node",
  },
});
