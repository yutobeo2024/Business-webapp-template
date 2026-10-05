import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` chỉ đọc schema để sinh SQL, không cần kết nối DB.
// Migration được ÁP DỤNG bằng `pnpm db:migrate` (src/migrate.ts), không dùng `drizzle-kit push`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
