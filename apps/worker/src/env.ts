import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    /** Lưu tệp, như api (ADR-0005): hai bên phải trỏ cùng một thư mục. */
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_DIR: z.string().min(1).default(".data/files"),
    /** Xuất file: số job chạy song song (Chromium tốn RAM), hạn tải về, số dòng tối đa mỗi lần xuất. */
    EXPORT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    EXPORT_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(24),
    EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
    /** Địa chỉ app (giống api): để dựng liên kết tuyệt đối trong email. */
    APP_ORIGIN: z.url().default("http://localhost:5173"),
    /** Bật kênh email: smtp(s)://user:pass@host:port. Bỏ trống = không gửi email (chỉ thông báo trong app). */
    SMTP_URL: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    MAIL_FROM: z.string().min(3).default("Hệ thống <no-reply@localhost>"),
    /** Số dòng dữ liệu tối đa mỗi tệp nhập Excel. */
    IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(100_000).default(5000),
    /** Khóa mã hóa bí mật lưu trong DB (token Zalo): 32 byte base64, `openssl rand -base64 32`. Bắt buộc khi bật Zalo. */
    APP_ENCRYPTION_KEY: z.string().optional(),
    /** Kênh Zalo ZNS (spec 003). Tắt mặc định; bật khi khách có Zalo OA và mẫu tin đã được duyệt (runbook notifications). */
    ZALO_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    ZALO_APP_ID: z.string().optional(),
    ZALO_SECRET_KEY: z.string().optional(),
    /** JSON: mã mẫu ZNS theo loại thông báo, ví dụ {"account.password_reset":"312345"}. */
    ZALO_TEMPLATES: z
      .string()
      .default("{}")
      .transform((v, ctx) => {
        try {
          return z.record(z.string(), z.string()).parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: "custom", message: 'ZALO_TEMPLATES phải là JSON dạng {"loại":"mã mẫu"}' });
          return z.NEVER;
        }
      }),
    ZALO_OAUTH_URL: z.url().default("https://oauth.zaloapp.com/v4/oa/access_token"),
    ZALO_ZNS_URL: z.url().default("https://business.openapi.zalo.me/message/template"),
    /** Đường dẫn Chromium trong image production; bỏ trống khi dev (dùng trình duyệt Playwright đã cài). */
    CHROMIUM_PATH: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    if (!e.ZALO_ENABLED) return;
    for (const k of ["ZALO_APP_ID", "ZALO_SECRET_KEY", "APP_ENCRYPTION_KEY"] as const) {
      if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "bắt buộc khi ZALO_ENABLED=true" });
    }
  });
export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(
      `Cấu hình môi trường không hợp lệ: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return r.data;
}
