import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { type JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUES } from "@app/shared";
import { ENV, type Env } from "../config/env.js";

/**
 * Đẩy job SAU khi transaction đã commit, có giới hạn thời gian chờ. Khi Redis mất kết nối, queue.add không lỗi mà
 * chờ vô hạn (ioredis xếp lệnh vào hàng chờ nội bộ): thiếu giới hạn thì request đã ghi DB xong vẫn treo, người dùng
 * bấm lại và nhận lỗi xung đột phiên bản. Quá hạn thì ném lỗi để nơi gọi ghi log; lệnh vẫn nằm trong hàng chờ và
 * được gửi khi Redis kết nối lại.
 */
export async function enqueueAfterCommit(
  queue: Pick<Queue, "add">,
  name: string,
  data: unknown,
  opts: JobsOptions,
  timeoutMs = 2000,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Hàng đợi không phản hồi sau ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([queue.add(name, data, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const REDIS = Symbol("REDIS");
export const NOTIFICATIONS_QUEUE = Symbol("NOTIFICATIONS_QUEUE");
export const EXPORTS_QUEUE = Symbol("EXPORTS_QUEUE");
export const IMPORTS_QUEUE = Symbol("IMPORTS_QUEUE");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
    {
      provide: NOTIFICATIONS_QUEUE,
      inject: [REDIS],
      useFactory: (connection: Redis) =>
        new Queue(QUEUES.notifications, {
          connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 10_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
    },
    {
      provide: EXPORTS_QUEUE,
      inject: [REDIS],
      useFactory: (connection: Redis) =>
        new Queue(QUEUES.exports, {
          connection,
          // Thử lại ít: lỗi xuất thường do dữ liệu/quyền (worker tự ghi FAILED), không phải lỗi mạng tạm thời.
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: "fixed", delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
    },
    {
      provide: IMPORTS_QUEUE,
      inject: [REDIS],
      useFactory: (connection: Redis) =>
        new Queue(QUEUES.imports, {
          connection,
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: "fixed", delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
    },
  ],
  exports: [REDIS, NOTIFICATIONS_QUEUE, EXPORTS_QUEUE, IMPORTS_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(EXPORTS_QUEUE) private readonly exportsQueue: Queue,
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.exportsQueue.close();
    await this.importsQueue.close();
    await this.redis.quit();
  }
}
