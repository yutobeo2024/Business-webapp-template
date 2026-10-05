import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  type CurrentUser as CurrentUserType,
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
} from "@app/shared";
import { CurrentUser } from "../../auth/decorators.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { NotificationsService } from "./notifications.service.js";

/** Mọi người dùng đã đăng nhập; mỗi người chỉ thấy thông báo của mình (service lọc theo user). */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query(new ZodPipe(listNotificationsQuerySchema)) q: ListNotificationsQuery,
  ) {
    return this.service.list(user, q);
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: CurrentUserType) {
    return this.service.unreadCount(user);
  }

  @Post("read-all")
  @HttpCode(200)
  markAllRead(@CurrentUser() user: CurrentUserType) {
    return this.service.markAllRead(user);
  }

  @Post(":id/read")
  @HttpCode(200)
  markRead(@CurrentUser() user: CurrentUserType, @Param("id", new ZodPipe(z.uuid())) id: string) {
    return this.service.markRead(user, id);
  }
}
