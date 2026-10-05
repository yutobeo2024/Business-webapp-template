import { Body, Controller, Get, Put } from "@nestjs/common";
import {
  type CurrentUser as CurrentUserType,
  type UpdateNotificationSettingsInput,
  updateNotificationSettingsSchema,
} from "@app/shared";
import { CurrentUser } from "../../auth/decorators.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { NotificationSettingsService } from "./notification-settings.service.js";

/** Cài đặt của chính người dùng đang đăng nhập. */
@Controller("account")
export class AccountController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get("notification-settings")
  getNotificationSettings(@CurrentUser() user: CurrentUserType) {
    return this.settings.get(user);
  }

  @Put("notification-settings")
  updateNotificationSettings(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(updateNotificationSettingsSchema)) body: UpdateNotificationSettingsInput,
  ) {
    return this.settings.update(user, body);
  }
}
