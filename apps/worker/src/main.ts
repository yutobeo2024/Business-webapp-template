import { fileURLToPath } from "node:url";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { createDb } from "@app/db";
import { createStorage, parseEncryptionKey } from "@app/server";
import { JOBS, type NotificationChannel, type NotificationDeliverJob, QUEUES } from "@app/shared";
import { loadEnv } from "./env.js";
import { createExportProcessor, EXPORT_MAINTENANCE_JOBS } from "./exports/processor.js";
import { PdfRenderer } from "./exports/pdf.js";
import { createImportProcessor, IMPORT_MAINTENANCE_JOBS } from "./imports/processor.js";
import type { NotificationSender } from "./notifications/channel.js";
import { MAX_DELIVERY_ATTEMPTS } from "./notifications/deliver.js";
import { EmailSender } from "./notifications/email.js";
import { ZaloZnsSender } from "./notifications/zalo.js";
import { createProcessor, MAINTENANCE_JOBS } from "./processors.js";

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, base: { service: "worker" } });
const handle = createDb(env.DATABASE_URL, { max: 5, appName: "worker" });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Kênh ngoài chỉ bật khi đã cấu hình (SMTP_URL). Thông báo trong app luôn có.
const email = env.SMTP_URL ? new EmailSender(env.SMTP_URL, env.MAIL_FROM, env.APP_ORIGIN) : null;
const zalo = env.ZALO_ENABLED
  ? new ZaloZnsSender(handle.db, {
      appId: env.ZALO_APP_ID!,
      secretKey: env.ZALO_SECRET_KEY!,
      templates: env.ZALO_TEMPLATES,
      oauthUrl: env.ZALO_OAUTH_URL,
      znsUrl: env.ZALO_ZNS_URL,
      encryptionKey: parseEncryptionKey(env.APP_ENCRYPTION_KEY!),
    })
  : null;
const senders: Partial<Record<NotificationChannel, NotificationSender>> = {
  ...(email ? { email } : {}),
  ...(zalo ? { zalo } : {}),
};
const scheduler = new Queue(QUEUES.notifications, { connection });
async function enqueueDeliveries(ids: string[], opts: { retry?: boolean } = {}): Promise<void> {
  const data = (deliveryId: string): NotificationDeliverJob => ({ deliveryId });
  await scheduler.addBulk(
    ids.map((id) => ({
      name: JOBS.notificationDeliver,
      data: data(id),
      opts: {
        // Lượt quét lại cần jobId mới (job cũ có thể còn lưu ở trạng thái xong/lỗi); trùng thì lần "giành" hàng chặn.
        jobId: opts.retry ? `delivery-${id}-${Date.now()}` : `delivery-${id}`,
        attempts: MAX_DELIVERY_ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    })),
  );
}

const worker = new Worker(
  QUEUES.notifications,
  createProcessor({ db: handle.db, log, senders, enqueueDeliveries, zalo }),
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

/** Gốc repo (STORAGE_DIR tương đối khi chạy dev): apps/worker/{src,dist} -> ../../../ */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const pdf = new PdfRenderer(env.CHROMIUM_PATH);
const exportsWorker = new Worker(
  QUEUES.exports,
  createExportProcessor({
    db: handle.db,
    log,
    storage: createStorage(env, REPO_ROOT),
    pdf,
    ttlHours: env.EXPORT_TTL_HOURS,
    maxRows: env.EXPORT_MAX_ROWS,
  }),
  { connection, concurrency: env.EXPORT_CONCURRENCY },
);

// Nhập Excel: một job một lúc (ghi DB nhiều dòng trong một transaction).
const importsWorker = new Worker(
  QUEUES.imports,
  createImportProcessor({
    db: handle.db,
    log,
    storage: createStorage(env, REPO_ROOT),
    maxRows: env.IMPORT_MAX_ROWS,
    notify: async (job) => {
      await scheduler.add(JOBS.notify, job, {
        jobId: `notify-${job.dedupeKey}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
  }),
  { connection, concurrency: 1 },
);

for (const w of [worker, exportsWorker, importsWorker]) {
  w.on("failed", (job, err) =>
    log.error({ jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, err }, "Job thất bại"),
  );
  w.on("error", (err) => log.error({ err }, "Worker lỗi"));
}

// Lịch bảo trì định kỳ: dọn phiên hết hạn lúc 03:00 hằng ngày (giờ Việt Nam). upsert nên không tạo trùng khi khởi động lại.
await scheduler.upsertJobScheduler(
  MAINTENANCE_JOBS.purgeSessions,
  { pattern: "0 3 * * *", tz: "Asia/Ho_Chi_Minh" },
  {
    name: MAINTENANCE_JOBS.purgeSessions,
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  },
);

// Gửi lại thông báo bị kẹt (job mất, worker chết giữa lúc gửi) mỗi 10 phút.
await scheduler.upsertJobScheduler(
  MAINTENANCE_JOBS.sweepDeliveries,
  { pattern: "*/10 * * * *", tz: "Asia/Ho_Chi_Minh" },
  { name: MAINTENANCE_JOBS.sweepDeliveries, opts: { attempts: 2, removeOnComplete: 10, removeOnFail: 100 } },
);

// Zalo: làm mới token hằng ngày để refresh token (hạn khoảng 3 tháng) không hết hạn khi lâu không gửi tin.
if (zalo) {
  await scheduler.upsertJobScheduler(
    MAINTENANCE_JOBS.refreshZaloToken,
    { pattern: "30 5 * * *", tz: "Asia/Ho_Chi_Minh" },
    {
      name: MAINTENANCE_JOBS.refreshZaloToken,
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 10,
        removeOnFail: 100,
      },
    },
  );
} else {
  await scheduler.removeJobScheduler(MAINTENANCE_JOBS.refreshZaloToken);
}

// Yêu cầu nhập Excel kẹt hoặc bỏ dở: mỗi 15 phút.
const importsScheduler = new Queue(QUEUES.imports, { connection });
await importsScheduler.upsertJobScheduler(
  IMPORT_MAINTENANCE_JOBS.sweepImports,
  { pattern: "*/15 * * * *", tz: "Asia/Ho_Chi_Minh" },
  {
    name: IMPORT_MAINTENANCE_JOBS.sweepImports,
    opts: { attempts: 2, removeOnComplete: 10, removeOnFail: 100 },
  },
);

// Dọn tệp xuất hết hạn và đính kèm đã xóa quá 7 ngày lúc 04:00 hằng ngày.
const exportsScheduler = new Queue(QUEUES.exports, { connection });
await exportsScheduler.upsertJobScheduler(
  EXPORT_MAINTENANCE_JOBS.cleanupFiles,
  { pattern: "0 4 * * *", tz: "Asia/Ho_Chi_Minh" },
  {
    name: EXPORT_MAINTENANCE_JOBS.cleanupFiles,
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  },
);
// Yêu cầu xuất bị kẹt (worker chết giữa chừng): đánh dấu lỗi mỗi 15 phút.
await exportsScheduler.upsertJobScheduler(
  EXPORT_MAINTENANCE_JOBS.markStuckExports,
  { pattern: "*/15 * * * *", tz: "Asia/Ho_Chi_Minh" },
  {
    name: EXPORT_MAINTENANCE_JOBS.markStuckExports,
    opts: { attempts: 2, removeOnComplete: 10, removeOnFail: 100 },
  },
);

log.info(
  {
    queues: [QUEUES.notifications, QUEUES.exports, QUEUES.imports],
    concurrency: env.WORKER_CONCURRENCY,
    exportConcurrency: env.EXPORT_CONCURRENCY,
    channels: Object.keys(senders),
  },
  "Worker đã sẵn sàng",
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Đang dừng worker, chờ job đang chạy hoàn tất");
  const timer = setTimeout(() => {
    log.error("Quá thời gian dừng, thoát cưỡng bức");
    process.exit(1);
  }, 30_000);
  try {
    await Promise.all([worker.close(), exportsWorker.close(), importsWorker.close()]);
    await Promise.all([scheduler.close(), exportsScheduler.close(), importsScheduler.close()]);
    await pdf.close();
    email?.close();
    await connection.quit();
    await handle.close();
    clearTimeout(timer);
    process.exit(0);
  } catch (err) {
    log.error({ err }, "Lỗi khi dừng worker");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
