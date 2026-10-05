/**
 * Kênh email qua SMTP (nodemailer). Dùng được với mọi nhà cung cấp có SMTP (Microsoft 365, Google Workspace, Amazon SES,
 * SendGrid, Mailgun...); dev dùng Mailpit. Nội dung dựng từ thông báo trong app, mọi giá trị đi qua `html` (escape).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { html } from "@app/server";
import {
  type NotificationSender,
  type OutgoingNotification,
  PermanentDeliveryError,
  type Recipient,
} from "./channel.js";

/** Chỉ đường dẫn tương đối trong app ("/x"), không nhận "//host" hay URL tuyệt đối (chống dẫn ra trang ngoài). */
export function absoluteLink(appOrigin: string, link: string | null): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) return null;
  return new URL(link, appOrigin).toString();
}

export function renderEmail(n: OutgoingNotification, appOrigin: string) {
  const url = absoluteLink(appOrigin, n.link);
  const settings = new URL("/account/notifications", appOrigin).toString();
  const button = url
    ? html`<p style="margin:0 0 20px">
        <a
          href="${url}"
          style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none"
          >Mở trong hệ thống</a
        >
      </p>`
    : null;
  const body = html`<!doctype html>
    <html lang="vi">
      <body
        style="font-family:Arial,sans-serif;font-size:14px;color:#111;margin:0;padding:24px;background:#f6f6f6"
      >
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
          <h1 style="font-size:18px;margin:0 0 12px">${n.title}</h1>
          <p style="margin:0 0 20px;line-height:1.5">${n.body}</p>
          ${button}
          <p style="margin:0;font-size:12px;color:#666">
            Tắt thông báo qua email tại <a href="${settings}" style="color:#666">Cài đặt thông báo</a>.
          </p>
        </div>
      </body>
    </html>`;
  const text = [
    n.title,
    "",
    n.body,
    ...(url ? ["", `Mở trong hệ thống: ${url}`] : []),
    "",
    `Cài đặt thông báo: ${settings}`,
  ].join("\n");
  return { subject: n.title, html: body.value, text };
}

/** Mã SMTP 5xx hoặc địa chỉ sai: thử lại vô ích. */
function isPermanent(err: unknown): boolean {
  const e = err as { responseCode?: number; code?: string };
  return (e.responseCode !== undefined && e.responseCode >= 500) || e.code === "EENVELOPE";
}

export class EmailSender implements NotificationSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly appOrigin: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(to: Recipient, n: OutgoingNotification): Promise<{ providerMessageId: string | null }> {
    const mail = renderEmail(n, this.appOrigin);
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: { name: to.fullName, address: to.email },
        ...mail,
      });
      return { providerMessageId: info.messageId ?? null };
    } catch (err) {
      if (isPermanent(err)) throw new PermanentDeliveryError((err as Error).message);
      throw err;
    }
  }

  close(): void {
    this.transport.close();
  }
}
