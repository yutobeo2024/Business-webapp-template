import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller.js";
import { NotificationSettingsService } from "./notification-settings.service.js";

@Module({
  controllers: [AccountController],
  providers: [NotificationSettingsService],
})
export class AccountModule {}
