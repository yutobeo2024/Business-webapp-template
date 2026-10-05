/**
 * Hàng đợi `exports` (spec 002): chạy một yêu cầu xuất và dọn tệp hết hạn. Idempotent: yêu cầu đã DONE/FAILED thì bỏ qua,
 * chạy lại sau lỗi không tạo tệp thừa (tệp chỉ được ghi nhận khi transaction cập nhật DONE thành công).
 */
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { Logger } from "pino";
import { exportJobs, files, importJobs, users, type Db } from "@app/db";
import {
  canPurgeDeletedFile,
  type FileStorage,
  loadAccess,
  purgeableDeletedFilesWhere,
  storeFile,
  withStoredFile,
} from "@app/server";
import { can, createExportSchema, EXPORT_TYPES, exportRunJobSchema, JOBS } from "@app/shared";
import type { PdfRenderer } from "./pdf.js";
import { ExportUserError, type RunnerContext, runExportType } from "./runners.js";

export const EXPORT_MAINTENANCE_JOBS = {
  cleanupFiles: "maintenance.cleanup_files",
  markStuckExports: "maintenance.mark_stuck_exports",
} as const;

export interface ExportDeps {
  db: Db;
  log: Logger;
  storage: FileStorage;
  pdf: PdfRenderer;
  ttlHours: number;
  maxRows: number;
}

/** Tệp xuất được tạo bởi mã; vẫn kiểm loại theo nội dung để chắc runner sinh đúng định dạng. */
const EXPORT_FILE_MAX_BYTES = 500 * 1024 * 1024;
const GENERIC_FAILURE = "Không tạo được tệp. Vui lòng thử lại sau hoặc báo quản trị viên.";
/** Đính kèm đã xóa mềm được giữ thêm 7 ngày (khôi phục khi xóa nhầm) rồi mới xóa hẳn. */
const SOFT_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Yêu cầu chờ/chạy quá lâu (worker chết giữa chừng, job mất): đánh dấu lỗi để người dùng xuất lại. */
const STUCK_AFTER_MS = 60 * 60 * 1000;

async function markFailed(db: Db, exportId: string, message: string): Promise<void> {
  await db
    .update(exportJobs)
    .set({ status: "FAILED", error: message, finishedAt: new Date() })
    .where(and(eq(exportJobs.id, exportId), inArray(exportJobs.status, ["QUEUED", "RUNNING"])));
}

/** Quyền HIỆN TẠI của người yêu cầu (bị khóa hoặc thu quyền sau khi bấm xuất thì không nhận được dữ liệu). */
async function loadRequester(db: Db, userId: string): Promise<RunnerContext["actor"]> {
  const [u] = await db
    .select({ id: users.id, departmentId: users.departmentId, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!u?.isActive) throw new ExportUserError("Tài khoản yêu cầu xuất đã bị khóa.");
  const { permissions } = await loadAccess(db, u.id);
  return { id: u.id, departmentId: u.departmentId, permissions };
}

export type RunOutcome = "done" | "failed" | "skipped";

/** Lần chạy khác đã hoàn tất/đánh dấu lỗi yêu cầu này trong lúc lần này đang chạy. */
class AlreadyFinished extends Error {}

export async function runExport(
  deps: ExportDeps,
  exportId: string,
  opts: { finalAttempt: boolean } = { finalAttempt: true },
): Promise<RunOutcome> {
  const { db, log } = deps;
  const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, exportId));
  if (!job) {
    log.warn({ exportId }, "Không có yêu cầu xuất này (đã bị xóa?)");
    return "skipped";
  }
  if (job.status === "DONE" || job.status === "FAILED") return "skipped";
  // Có điều kiện: API có thể vừa đánh dấu FAILED (không xếp được hàng) sau khi ta đọc QUEUED.
  const [started] = await db
    .update(exportJobs)
    .set({ status: "RUNNING", startedAt: new Date() })
    .where(and(eq(exportJobs.id, exportId), inArray(exportJobs.status, ["QUEUED", "RUNNING"])))
    .returning({ id: exportJobs.id });
  if (!started) return "skipped";

  try {
    const parsed = createExportSchema.safeParse({ type: job.type, params: job.params });
    if (!parsed.success) throw new ExportUserError("Yêu cầu xuất không hợp lệ.");
    const input = parsed.data;
    const def = EXPORT_TYPES[input.type];
    const actor = await loadRequester(db, job.requestedBy);
    if (def.permission && !can(actor, def.permission)) {
      throw new ExportUserError("Bạn không còn quyền xuất dữ liệu này.");
    }
    const now = new Date();
    const result = await runExportType(input, { db, actor, pdf: deps.pdf, maxRows: deps.maxRows, now });

    const saved = await withStoredFile(deps.storage, (storage) =>
      db.transaction(async (tx) => {
        const { row } = await storeFile(tx, storage, {
          buffer: result.buffer,
          originalName: result.fileName,
          allowed: [def.format],
          maxBytes: EXPORT_FILE_MAX_BYTES,
          uploadedBy: job.requestedBy,
          entityType: "export_job",
          entityId: job.id,
        });
        const [updated] = await tx
          .update(exportJobs)
          .set({
            status: "DONE",
            fileId: row.id,
            rowCount: result.rowCount,
            error: null,
            finishedAt: now,
            expiresAt: new Date(now.getTime() + deps.ttlHours * 60 * 60 * 1000),
          })
          .where(and(eq(exportJobs.id, job.id), eq(exportJobs.status, "RUNNING")))
          .returning({ id: exportJobs.id });
        // Đã có lần chạy khác hoàn tất/đánh dấu lỗi: rollback, tệp vừa ghi bị xóa.
        if (!updated) throw new AlreadyFinished();
        return row;
      }),
    ).catch((err: unknown) => {
      if (err instanceof AlreadyFinished) return null;
      throw err;
    });
    if (!saved) return "skipped";
    log.info(
      { exportId, type: input.type, rows: result.rowCount, bytes: saved.sizeBytes },
      "Đã tạo tệp xuất",
    );
    return "done";
  } catch (err) {
    if (err instanceof ExportUserError) {
      await markFailed(db, exportId, err.message);
      log.info({ exportId, reason: err.message }, "Yêu cầu xuất không thực hiện được");
      return "failed";
    }
    log.error({ exportId, err }, "Lỗi khi tạo tệp xuất");
    if (opts.finalAttempt) await markFailed(db, exportId, GENERIC_FAILURE);
    throw err;
  }
}

/**
 * Yêu cầu chờ/chạy quá 1 giờ (worker chết giữa chừng, job mất khỏi hàng đợi) thành FAILED, để người dùng thấy lỗi và
 * không bị chiếm suất giới hạn số lần xuất. Chạy mỗi 15 phút.
 */
export async function markStuckExports(
  deps: Pick<ExportDeps, "db" | "log">,
  now = new Date(),
): Promise<number> {
  const stuck = await deps.db
    .update(exportJobs)
    .set({ status: "FAILED", error: "Quá thời gian xử lý. Vui lòng xuất lại.", finishedAt: now })
    .where(
      and(
        inArray(exportJobs.status, ["QUEUED", "RUNNING"]),
        lt(exportJobs.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    )
    .returning({ id: exportJobs.id });
  if (stuck.length) deps.log.warn({ ids: stuck.map((s) => s.id) }, "Đánh dấu lỗi yêu cầu xuất bị kẹt");
  return stuck.length;
}

/**
 * Dọn dẹp hằng ngày: tệp xuất hết hạn, đính kèm đã xóa mềm quá 7 ngày, tệp nhập Excel đã xong quá 7 ngày (xóa tệp vật lý trước rồi mới xóa hàng; lỗi giữa
 * chừng thì lần sau làm tiếp).
 */
export async function cleanupFiles(
  deps: Pick<ExportDeps, "db" | "log" | "storage">,
  now = new Date(),
): Promise<{ removed: number }> {
  const { db, storage } = deps;
  const expiredExports = await db
    .select({ id: files.id, key: files.storageKey })
    .from(exportJobs)
    .innerJoin(files, eq(files.id, exportJobs.fileId))
    .where(and(isNotNull(exportJobs.expiresAt), lt(exportJobs.expiresAt, now)))
    .limit(5000);
  // Đính kèm đã xóa mềm: giữ theo FILE_RETENTION của từng loại (chứng từ "forever" không bao giờ bị xóa vật lý).
  const deletedAttachments = (
    await db
      .select({
        id: files.id,
        key: files.storageKey,
        entityType: files.entityType,
        deletedAt: files.deletedAt,
      })
      .from(files)
      .where(purgeableDeletedFilesWhere(now, ["export_job", "import_job"]))
      .orderBy(files.deletedAt)
      .limit(5000)
  ).filter((f) => canPurgeDeletedFile(f.entityType, f.deletedAt!, now)); // kiểm lại lần nữa ngoài SQL

  // Tệp nhập Excel: không cần giữ khi lần nhập đã kết thúc quá 7 ngày (dữ liệu đã vào DB, audit giữ sha256).
  const finishedImports = await db
    .select({ id: files.id, key: files.storageKey })
    .from(importJobs)
    .innerJoin(files, eq(files.id, importJobs.fileId))
    .where(
      and(
        inArray(importJobs.status, ["DONE", "INVALID", "FAILED", "CANCELLED"]),
        lt(importJobs.updatedAt, new Date(now.getTime() - SOFT_DELETE_GRACE_MS)),
      ),
    )
    .limit(5000);

  let removed = 0;
  for (const f of [...expiredExports, ...deletedAttachments, ...finishedImports]) {
    await storage.remove(f.key);
    await db.delete(files).where(eq(files.id, f.id)); // export_jobs.file_id -> NULL (ON DELETE SET NULL)
    removed++;
  }
  deps.log.info({ removed }, "Đã dọn tệp hết hạn");
  return { removed };
}

export function createExportProcessor(deps: ExportDeps) {
  return async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case JOBS.exportRun: {
        const parsed = exportRunJobSchema.safeParse(job.data);
        if (!parsed.success) throw new UnrecoverableError(`Job ${job.name} sai định dạng`);
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        return runExport(deps, parsed.data.exportId, { finalAttempt });
      }
      case EXPORT_MAINTENANCE_JOBS.cleanupFiles:
        return cleanupFiles(deps);
      case EXPORT_MAINTENANCE_JOBS.markStuckExports:
        return markStuckExports(deps);
      default:
        throw new Error(`Không có processor cho job "${job.name}"`);
    }
  };
}
