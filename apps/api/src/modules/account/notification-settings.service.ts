/** Người dùng tự bật/tắt kênh thông báo ngoài của mình (spec 003). Thông báo trong app luôn bật. */
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { userNotificationSettings, users, type Db } from "@app/db";
import {
  type CurrentUser,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationSettingDto,
  type UpdateNotificationSettingsInput,
} from "@app/shared";
import { ENV, type Env } from "../../config/env.js";
import { DB } from "../../db/db.module.js";

@Injectable()
export class NotificationSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Vì sao kênh chưa dùng được với tài khoản này (null: dùng được). */
  private unavailableReason(channel: NotificationChannel, phone: string | null): string | null {
    switch (channel) {
      case "email":
        return this.env.SMTP_URL ? null : "Hệ thống chưa cấu hình gửi email";
      case "zalo":
        if (!this.env.ZALO_ENABLED) return "Hệ thống chưa bật Zalo";
        return phone ? null : "Tài khoản chưa có số điện thoại, nhờ quản trị viên cập nhật";
    }
  }

  async get(actor: CurrentUser): Promise<NotificationSettingDto[]> {
    const [u] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, actor.id));
    const rows = await this.db
      .select()
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, actor.id));
    const enabled = new Map(rows.map((r) => [r.channel, r.enabled]));
    return NOTIFICATION_CHANNELS.map((channel) => {
      const reason = this.unavailableReason(channel, u?.phone ?? null);
      return {
        channel,
        enabled: enabled.get(channel) ?? true,
        available: !reason,
        unavailableReason: reason,
      };
    });
  }

  async update(
    actor: CurrentUser,
    input: UpdateNotificationSettingsInput,
  ): Promise<NotificationSettingDto[]> {
    await this.db
      .insert(userNotificationSettings)
      .values(
        NOTIFICATION_CHANNELS.map((channel) => ({ userId: actor.id, channel, enabled: input[channel] })),
      )
      .onConflictDoUpdate({
        target: [userNotificationSettings.userId, userNotificationSettings.channel],
        set: { enabled: sql`excluded.enabled` },
      });
    return this.get(actor);
  }
}
