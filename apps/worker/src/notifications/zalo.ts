/**
 * Kênh Zalo ZNS (spec 003, ADR-0006): gửi tin theo mẫu đã được Zalo duyệt tới số điện thoại. Tắt mặc định (ZALO_ENABLED).
 * Endpoint, tham số và mã lỗi theo tài liệu Zalo tại thời điểm viết; PHẢI đối chiếu tài liệu hiện hành khi bật cho khách
 * (runbook notifications). URL cấu hình được để test bằng máy chủ giả.
 */
import { eq } from "drizzle-orm";
import { integrationTokens, type Db } from "@app/db";
import { decryptSecret, encryptSecret } from "@app/server";
import { IMPORT_STATUS_LABELS, type NotificationData, type NotificationType } from "@app/shared";
import { formatVnd } from "@app/shared"; // sample
import {
  type NotificationSender,
  type OutgoingNotification,
  PermanentDeliveryError,
  type Recipient,
} from "./channel.js";

export const ZALO_PROVIDER = "zalo_oa";

/**
 * Tham số gửi kèm mẫu ZNS cho từng loại thông báo. Tên tham số phải KHỚP mẫu khách đăng ký với Zalo; đổi tên ở đây
 * nếu mẫu của khách đặt khác. Thiếu loại nào thì typecheck báo lỗi.
 */
export const ZALO_PARAMS: { [T in NotificationType]: (d: NotificationData<T>) => Record<string, string> } = {
  "account.password_reset": (d) => ({ nguoi_dat_lai: d.resetByName }),
  "import.finished": (d) => ({
    loai_du_lieu: d.label,
    ket_qua: IMPORT_STATUS_LABELS[d.status],
    so_dong: String(d.importedCount ?? 0),
    so_loi: String(d.errorCount),
  }),
  // sample:begin
  "pr.pending_approval": (d) => ({
    ma_phieu: d.code,
    noi_dung: d.title,
    so_tien: formatVnd(d.totalAmount),
    nguoi_lap: d.requesterName,
  }),
  "pr.approved": (d) => ({ ma_phieu: d.code, noi_dung: d.title, so_tien: formatVnd(d.totalAmount) }),
  "pr.rejected": (d) => ({ ma_phieu: d.code, noi_dung: d.title, ly_do: d.reason }),
  // sample:end
};

export interface ZaloConfig {
  appId: string;
  secretKey: string;
  /** Mã mẫu ZNS theo loại thông báo, ví dụ {"account.password_reset": "312345"}. */
  templates: Partial<Record<NotificationType, string>>;
  oauthUrl: string;
  znsUrl: string;
  encryptionKey: Buffer;
}

/** Lỗi xác thực với Zalo (refresh token hết hạn/thu hồi): cần quản trị nạp lại token, thử lại vô ích. */
export class ZaloAuthError extends PermanentDeliveryError {}

/** Mã lỗi ZNS nên thử lại: access token hết hạn giữa chừng (-124), vượt hạn mức tạm thời (-32). Còn lại: vĩnh viễn. */
const RETRYABLE_ERRORS = new Set([-124, -32]);
/** Làm mới sớm 5 phút trước khi access token hết hạn. */
const EARLY_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: string | number;
  error?: number;
  error_name?: string;
  error_description?: string;
}

export class ZaloZnsSender implements NotificationSender {
  constructor(
    private readonly db: Db,
    private readonly cfg: ZaloConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Lưu refresh token ban đầu (lệnh CLI zalo-token). Access token sẽ được lấy ở lần gửi đầu. */
  static async storeRefreshToken(db: Db, refreshToken: string, key: Buffer): Promise<void> {
    const refreshTokenEnc = encryptSecret(refreshToken, key);
    await db
      .insert(integrationTokens)
      .values({ provider: ZALO_PROVIDER, refreshTokenEnc, accessTokenEnc: null, accessExpiresAt: null })
      .onConflictDoUpdate({
        target: integrationTokens.provider,
        set: { refreshTokenEnc, accessTokenEnc: null, accessExpiresAt: null },
      });
  }

  /**
   * Access token còn hạn; hết hạn thì làm mới trong transaction KHÓA DÒNG: nhiều job song song chỉ làm mới một lần, job
   * đến sau đọc lại token mới (refresh token Zalo dùng một lần, làm mới hai lần là mất token).
   */
  async accessToken(force = false): Promise<string> {
    const key = this.cfg.encryptionKey;
    const valid = (r: typeof integrationTokens.$inferSelect) =>
      !force && r.accessTokenEnc && r.accessExpiresAt && r.accessExpiresAt.getTime() - EARLY_MS > Date.now();

    const [row] = await this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.provider, ZALO_PROVIDER));
    if (!row) throw new ZaloAuthError("Chưa nạp token Zalo (lệnh zalo-token)");
    if (valid(row)) return decryptSecret(row.accessTokenEnc!, key);

    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(integrationTokens)
        .where(eq(integrationTokens.provider, ZALO_PROVIDER))
        .for("update");
      if (!locked) throw new ZaloAuthError("Chưa nạp token Zalo (lệnh zalo-token)");
      // Job khác vừa làm mới trong lúc ta chờ khóa (trừ khi chính token đó bị Zalo từ chối: force).
      if (valid(locked) || (force && locked.updatedAt > row.updatedAt)) {
        return decryptSecret(locked.accessTokenEnc!, key);
      }
      const res = await this.fetchImpl(this.cfg.oauthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: this.cfg.secretKey },
        body: new URLSearchParams({
          app_id: this.cfg.appId,
          grant_type: "refresh_token",
          refresh_token: decryptSecret(locked.refreshTokenEnc, key),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Zalo OAuth HTTP ${res.status}`); // tạm thời: thử lại
      const body = (await res.json()) as TokenResponse;
      if (!body.access_token || !body.refresh_token) {
        throw new ZaloAuthError(
          `Làm mới token Zalo bị từ chối (${body.error ?? "?"} ${body.error_name ?? ""}). Nạp lại bằng lệnh zalo-token.`,
        );
      }
      const expiresIn = Number(body.expires_in ?? 3600);
      await tx
        .update(integrationTokens)
        .set({
          accessTokenEnc: encryptSecret(body.access_token, key),
          refreshTokenEnc: encryptSecret(body.refresh_token, key),
          accessExpiresAt: new Date(Date.now() + expiresIn * 1000),
        })
        .where(eq(integrationTokens.provider, ZALO_PROVIDER));
      return body.access_token;
    });
  }

  async send(to: Recipient, n: OutgoingNotification): Promise<{ providerMessageId: string | null }> {
    if (!to.phone) throw new PermanentDeliveryError("Tài khoản chưa có số điện thoại");
    const templateId = this.cfg.templates[n.type];
    if (!templateId)
      throw new PermanentDeliveryError(`Chưa cấu hình mẫu ZNS cho loại "${n.type}" (ZALO_TEMPLATES)`);
    const templateData = (ZALO_PARAMS[n.type] as (d: unknown) => Record<string, string>)(n.data);

    const attempt = async (token: string) => {
      const res = await this.fetchImpl(this.cfg.znsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: token },
        body: JSON.stringify({
          phone: to.phone,
          template_id: templateId,
          template_data: templateData,
          tracking_id: n.trackingId,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Zalo ZNS HTTP ${res.status}`); // tạm thời: thử lại
      return (await res.json()) as { error: number; message?: string; data?: { msg_id?: string } };
    };

    let body = await attempt(await this.accessToken());
    // Token bị Zalo từ chối dù chưa tới hạn (thu hồi, đổi app): làm mới bắt buộc rồi thử đúng một lần nữa.
    if (body.error === -124) body = await attempt(await this.accessToken(true));
    if (body.error === 0) return { providerMessageId: body.data?.msg_id ?? null };
    const message = `Zalo ZNS lỗi ${body.error}: ${body.message ?? ""}`.slice(0, 300);
    if (RETRYABLE_ERRORS.has(body.error)) throw new Error(message);
    throw new PermanentDeliveryError(message);
  }
}
