/** Thông báo trong app của chính người dùng (spec 003). Thông báo của người khác: 404, không lộ là có tồn tại. */
import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { notifications, type Db } from "@app/db";
import { pageOffset, paginated } from "@app/server";
import type {
  CurrentUser,
  ListNotificationsQuery,
  NotificationDto,
  NotificationType,
  Paginated,
} from "@app/shared";
import { Errors } from "../../common/business-error.js";
import { DB } from "../../db/db.module.js";

type Row = typeof notifications.$inferSelect;

const toDto = (r: Row): NotificationDto => ({
  id: r.id,
  type: r.type as NotificationType,
  title: r.title,
  body: r.body,
  link: r.link,
  createdAt: r.createdAt.toISOString(),
  readAt: r.readAt?.toISOString() ?? null,
});

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(actor: CurrentUser, q: ListNotificationsQuery): Promise<Paginated<NotificationDto>> {
    const where = and(
      eq(notifications.userId, actor.id),
      q.unread ? isNull(notifications.readAt) : undefined,
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.pageSize)
        .offset(pageOffset(q)),
      this.db.select({ total: count() }).from(notifications).where(where),
    ]);
    return paginated(rows.map(toDto), totals[0]?.total ?? 0, q);
  }

  async unreadCount(actor: CurrentUser): Promise<{ count: number }> {
    const [r] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
    return { count: r?.count ?? 0 };
  }

  async markRead(actor: CurrentUser, id: string): Promise<NotificationDto> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)));
    if (!row) throw Errors.notFound("NOTIFICATION");
    if (row.readAt) return toDto(row);
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)))
      .returning();
    return toDto(updated ?? row);
  }

  async markAllRead(actor: CurrentUser): Promise<{ updated: number }> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }
}
