import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { PermissionGuard } from "./auth/access.js";
import { AuthModule } from "./auth/auth.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { OriginGuard, SessionGuard } from "./auth/guards.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ENV, type Env } from "./config/env.js";
import { DbModule } from "./db/db.module.js";
import { FilesModule } from "./files/files.module.js";
import { HealthModule } from "./health/health.module.js";
import { ExportsModule } from "./modules/exports/exports.module.js";
import { ImportsModule } from "./modules/imports/imports.module.js";
import { AccountModule } from "./modules/account/account.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { PurchaseRequestsModule } from "./modules/purchase-requests/purchase-requests.module.js"; // sample
import { QueueModule } from "./queue/queue.module.js";

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
            // Không log cookie, header xác thực, body request.
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
            autoLogging: { ignore: (req) => req.url?.startsWith("/api/health") ?? false },
          },
        }),
        ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
        DbModule,
        FilesModule,
        QueueModule,
        HealthModule,
        AuthModule,
        AdminModule,
        PurchaseRequestsModule, // sample
        ExportsModule,
        ImportsModule,
        NotificationsModule,
        AccountModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        // Thứ tự guard: chặn tần suất -> kiểm tra nguồn gửi (CSRF) -> phiên đăng nhập -> quyền
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        // Sau SessionGuard: cần req.user. Endpoint gắn @RequirePermission(...) thiếu quyền thì 403.
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
      exports: [ENV],
    };
  }
}
