import { Controller, Get, HttpCode, Inject, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { sql } from "drizzle-orm";
import type { Response } from "express";
import type { Redis } from "ioredis";
import { Public } from "../auth/decorators.js";
import { DB, type Db } from "../db/db.module.js";
import { REDIS } from "../queue/queue.module.js";

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: tiến trình còn sống. Không kiểm tra phụ thuộc. */
  @Get("live")
  @HttpCode(200)
  live(): { status: string } {
    return { status: "ok" };
  }

  /** Readiness: DB và Redis dùng được. Dùng cho Docker healthcheck, deploy và uptime monitor. */
  @Get()
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    await Promise.all([
      withTimeout(this.db.execute(sql`select 1`), 2000)
        .then(() => (checks.database = "ok"))
        .catch(() => (checks.database = "fail")),
      withTimeout(this.redis.ping(), 2000)
        .then(() => (checks.redis = "ok"))
        .catch(() => (checks.redis = "fail")),
    ]);
    const ok = Object.values(checks).every((v) => v === "ok");
    res.status(ok ? 200 : 503);
    return { status: ok ? "ok" : "degraded", checks };
  }
}
