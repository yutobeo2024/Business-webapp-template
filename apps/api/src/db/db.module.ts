import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type Db, type DbHandle } from "@app/db";
import { ENV, type Env } from "../config/env.js";

export const DB_HANDLE = Symbol("DB_HANDLE");
export const DB = Symbol("DB");
export type { Db };

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DbHandle =>
        createDb(env.DATABASE_URL, { max: env.DB_POOL_MAX, appName: "api" }),
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: DbHandle) => h.db },
  ],
  exports: [DB, DB_HANDLE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
