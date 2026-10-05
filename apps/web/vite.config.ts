import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // Dev: gọi /api qua proxy để cùng origin với cookie phiên, giống production (Caddy).
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { sourcemap: true, outDir: "dist" },
});
