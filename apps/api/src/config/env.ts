import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origin hợp lệ của frontend, dùng cho kiểm tra CSRF và CORS. Ví dụ https://app.congty.vn */
  // Chỉ http/https: "localhost:5173" (thiếu scheme) vẫn là URL hợp lệ nhưng origin của nó là chuỗi "null".
  // Chuẩn hóa về origin (bỏ dấu "/" cuối) để so khớp chính xác với header Origin.
  APP_ORIGIN: z
    .url({ protocol: /^https?$/, error: "phải là địa chỉ http(s), ví dụ https://app.congty.vn" })
    .transform((u) => new URL(u).origin),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Phiên hết hạn sau ngần này giờ KHÔNG hoạt động (trượt theo thao tác). */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  /** Hạn tuyệt đối: quá ngần này ngày kể từ lúc đăng nhập phải đăng nhập lại, dù vẫn đang hoạt động. */
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Số reverse proxy đứng trước API (Caddy = 1). Cần đúng để lấy IP thật cho rate limit và audit. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Lưu tệp (ADR-0005). Hiện chỉ "local"; thư mục tuyệt đối, hoặc tương đối so với gốc repo khi chạy dev. */
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().min(1).default(".data/files"),
  /** Dung lượng tối đa một tệp tải lên. Caddy (infra/Caddyfile) giới hạn body lớn hơn giá trị này một chút. */
  FILE_MAX_MB: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * Kênh thông báo ngoài (worker gửi; api chỉ dùng để cho người dùng biết kênh nào đang có). Cùng giá trị với worker.
   */
  SMTP_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  ZALO_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

/** Validate env lúc khởi động. Sai thì dừng ngay, chỉ in TÊN biến lỗi, không in giá trị (tránh lộ secret). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${names}`);
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");
