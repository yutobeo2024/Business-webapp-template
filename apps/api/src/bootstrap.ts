import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.js";

/** Tạo app đã cấu hình đầy đủ. Dùng chung cho main.ts và test tích hợp HTTP. */
export async function createApp(env: Env, opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    logger: opts.logger === false ? false : undefined,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "1mb" });
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  return app;
}
