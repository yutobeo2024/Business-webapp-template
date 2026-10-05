/**
 * Hàng đợi `imports` (spec 003): kiểm tệp (xem trước) và ghi khi người dùng xác nhận. Ghi TẤT CẢ trong một transaction
 * sau khi kiểm LẠI (dữ liệu có thể đã đổi từ lúc xem trước): có lỗi thì không ghi dòng nào. Quyền của người nhập nạp lại
 * ở cả hai bước. Idempotent: chỉ xử lý khi trạng thái đúng bước.
 */
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Logger } from "pino";
import { files, importJobs, users, type Db } from "@app/db";
import {
  type FileStorage,
  isUniqueViolation,
  loadAccess,
  readImportSheet,
  validateImportRows,
  IMPORT_DEFINITIONS,
  writeAudit,
} from "@app/server";
import {
  can,
  IMPORT_PREVIEW_ROWS,
  IMPORT_TYPES,
  importJobSchema,
  type ImportRowError,
  type ImportStatus,
  type ImportType,
  importTypeSchema,
  JOBS,
  type NotifyJob,
} from "@app/shared";

export interface ImportDeps {
  db: Db;
  log: Logger;
  storage: FileStorage;
  maxRows: number;
  /** Đẩy job tạo thông báo (main.ts nối vào hàng đợi notifications). */
  notify?: (job: NotifyJob) => Promise<void>;
}

/** Báo người nhập kết quả (họ có thể đã đóng hộp thoại). Lỗi gửi không làm hỏng việc nhập. */
async function notifyOutcome(
  deps: ImportDeps,
  job: Pick<ImportRow, "id" | "type" | "requestedBy">,
  status: "READY" | "DONE" | "INVALID" | "FAILED",
  counts: { importedCount?: number | null; errorCount?: number } = {},
): Promise<void> {
  const def = Object.hasOwn(IMPORT_TYPES, job.type) ? IMPORT_TYPES[job.type as ImportType] : null;
  await deps
    .notify?.({
      type: "import.finished",
      userIds: [job.requestedBy],
      data: {
        importId: job.id,
        label: def?.label ?? job.type,
        status,
        importedCount: counts.importedCount ?? null,
        errorCount: counts.errorCount ?? 0,
        returnPath: def?.returnPath ?? null,
      },
      dedupeKey: `import-${job.id}-${status}`,
    })
    .catch((err: unknown) =>
      deps.log.error({ err, importId: job.id }, "Không đẩy được thông báo nhập Excel"),
    );
}

type ImportRow = typeof importJobs.$inferSelect;
const fileError = (message: string): ImportRowError[] => [{ row: null, column: null, message }];

/** Lỗi người dùng tự sửa được: ghi INVALID kèm câu này. */
class ImportProblem extends Error {
  constructor(readonly errors: ImportRowError[]) {
    super(errors[0]?.message ?? "Dữ liệu không hợp lệ");
  }
}

async function setStatus(db: Db, id: string, from: ImportStatus, patch: Partial<ImportRow>): Promise<void> {
  await db
    .update(importJobs)
    .set(patch)
    .where(and(eq(importJobs.id, id), eq(importJobs.status, from)));
}

/** Đọc yêu cầu, kiểm người nhập còn hoạt động và còn quyền, đọc tệp. */
async function load(deps: ImportDeps, job: ImportRow) {
  const type = importTypeSchema.parse(job.type);
  const [u] = await deps.db
    .select({ isActive: users.isActive, departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, job.requestedBy));
  if (!u?.isActive) throw new ImportProblem(fileError("Tài khoản nhập dữ liệu đã bị khóa."));
  const { permissions } = await loadAccess(deps.db, job.requestedBy);
  if (!can({ permissions }, IMPORT_TYPES[type].permission)) {
    throw new ImportProblem(fileError("Bạn không còn quyền nhập dữ liệu này."));
  }
  const [file] = job.fileId ? await deps.db.select().from(files).where(eq(files.id, job.fileId)) : [];
  if (!file || file.deletedAt) throw new ImportProblem(fileError("Tệp tải lên không còn, hãy tải lại."));
  const chunks: Buffer[] = [];
  for await (const c of await deps.storage.open(file.storageKey)) chunks.push(c as Buffer);
  const sheet = await readImportSheet(Buffer.concat(chunks), type, deps.maxRows);
  if (sheet.fileErrors.length) throw new ImportProblem(sheet.fileErrors);
  return { type, rows: sheet.rows };
}

export async function validateImport(deps: ImportDeps, importId: string): Promise<ImportStatus | "skipped"> {
  const [job] = await deps.db.select().from(importJobs).where(eq(importJobs.id, importId));
  if (job?.status !== "VALIDATING") return "skipped";
  try {
    const { type, rows } = await load(deps, job);
    const result = await validateImportRows(deps.db, type, rows);
    const headers = IMPORT_TYPES[type].columns;
    const preview = result.valid
      .slice(0, IMPORT_PREVIEW_ROWS)
      .map((v) =>
        Object.fromEntries(
          headers.map((c) => [c.header, String((v.data as Record<string, unknown>)[c.key] ?? "")]),
        ),
      );
    const status: ImportStatus = result.errorCount > 0 || rows.length === 0 ? "INVALID" : "READY";
    await setStatus(deps.db, importId, "VALIDATING", {
      status,
      totalRows: rows.length,
      errors: rows.length === 0 ? fileError("Tệp không có dòng dữ liệu nào") : result.errors,
      errorCount: rows.length === 0 ? 1 : result.errorCount,
      preview,
    });
    await notifyOutcome(deps, job, status === "READY" ? "READY" : "INVALID", {
      errorCount: rows.length === 0 ? 1 : result.errorCount,
    });
    return status;
  } catch (err) {
    if (!(err instanceof ImportProblem)) throw err;
    await setStatus(deps.db, importId, "VALIDATING", {
      status: "INVALID",
      errors: err.errors,
      errorCount: err.errors.length,
      finishedAt: new Date(),
    });
    await notifyOutcome(deps, job, "INVALID", { errorCount: err.errors.length });
    return "INVALID";
  }
}

export async function commitImport(deps: ImportDeps, importId: string): Promise<ImportStatus | "skipped"> {
  const [job] = await deps.db.select().from(importJobs).where(eq(importJobs.id, importId));
  if (job?.status !== "COMMITTING") return "skipped";
  try {
    const { type, rows } = await load(deps, job);
    const count = await deps.db.transaction(async (tx) => {
      // Khóa yêu cầu: hai lần chạy (job thử lại) không cùng ghi.
      const [locked] = await tx.select().from(importJobs).where(eq(importJobs.id, importId)).for("update");
      if (locked?.status !== "COMMITTING") return null;
      const result = await validateImportRows(tx, type, rows);
      if (result.errorCount > 0) throw new ImportProblem(result.errors);
      const n = await IMPORT_DEFINITIONS[type].commit(
        tx,
        result.valid.map((v) => v.data),
      );
      await writeAudit(tx, {
        actorId: job.requestedBy,
        action: "import.commit",
        entityType: "import_job",
        entityId: importId,
        after: { type, rows: n, fileId: job.fileId },
      });
      await tx
        .update(importJobs)
        .set({ status: "DONE", importedCount: n, finishedAt: new Date() })
        .where(eq(importJobs.id, importId));
      return n;
    });
    if (count === null) return "skipped";
    deps.log.info({ importId, type, rows: count }, "Đã nhập dữ liệu từ Excel");
    await notifyOutcome(deps, job, "DONE", { importedCount: count });
    return "DONE";
  } catch (err) {
    const problem =
      err instanceof ImportProblem
        ? err
        : isUniqueViolation(err)
          ? new ImportProblem(
              fileError("Dữ liệu vừa thay đổi (có mã bị trùng). Hãy kiểm tra lại tệp và nhập lại."),
            )
          : null;
    if (!problem) throw err;
    await setStatus(deps.db, importId, "COMMITTING", {
      status: "INVALID",
      errors: problem.errors,
      errorCount: problem.errors.length,
      finishedAt: new Date(),
    });
    await notifyOutcome(deps, job, "INVALID", { errorCount: problem.errors.length });
    return "INVALID";
  }
}

export const IMPORT_MAINTENANCE_JOBS = {
  sweepImports: "maintenance.sweep_imports",
} as const;
/** Kiểm/ghi một tệp vài nghìn dòng mất vài giây; quá 30 phút là job đã mất (worker chết, Redis mất job). */
const STUCK_AFTER_MS = 30 * 60 * 1000;
/** Tệp đã kiểm xong mà người dùng bỏ đó, không xác nhận cũng không hủy: hủy sau 7 ngày để tệp được dọn. */
const ABANDONED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Chạy mỗi 15 phút: yêu cầu kẹt ở VALIDATING/COMMITTING thành FAILED (giao diện thoát trạng thái "đang xử lý"); READY bỏ dở
 * quá 7 ngày thành CANCELLED. Sau đó job dọn dẹp 04:00 xóa tệp của chúng.
 */
export async function sweepImports(deps: Pick<ImportDeps, "db" | "log">, now = new Date()) {
  const stuck = await deps.db
    .update(importJobs)
    .set({
      status: "FAILED",
      errors: fileError("Quá thời gian xử lý. Vui lòng tải tệp lên lại."),
      errorCount: 1,
      finishedAt: now,
    })
    .where(
      and(
        inArray(importJobs.status, ["VALIDATING", "COMMITTING"]),
        lt(importJobs.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    )
    .returning({ id: importJobs.id });
  const abandoned = await deps.db
    .update(importJobs)
    .set({ status: "CANCELLED", finishedAt: now })
    .where(
      and(
        eq(importJobs.status, "READY"),
        lt(importJobs.updatedAt, new Date(now.getTime() - ABANDONED_AFTER_MS)),
      ),
    )
    .returning({ id: importJobs.id });
  if (stuck.length || abandoned.length) {
    deps.log.info({ stuck: stuck.length, abandoned: abandoned.length }, "Quét lại yêu cầu nhập Excel");
  }
  return { stuck: stuck.length, abandoned: abandoned.length };
}

export function createImportProcessor(deps: ImportDeps) {
  return async (job: Job): Promise<unknown> => {
    if (job.name === IMPORT_MAINTENANCE_JOBS.sweepImports) return sweepImports(deps);
    const parsed = importJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Job ${job.name} sai định dạng`);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const { importId } = parsed.data;
    try {
      switch (job.name) {
        case JOBS.importValidate:
          return await validateImport(deps, importId);
        case JOBS.importCommit:
          return await commitImport(deps, importId);
        default:
          throw new Error(`Không có processor cho job "${job.name}"`);
      }
    } catch (err) {
      deps.log.error({ importId, err }, "Lỗi khi xử lý nhập Excel");
      if (finalAttempt) {
        await deps.db
          .update(importJobs)
          .set({
            status: "FAILED",
            errors: fileError("Lỗi hệ thống khi xử lý tệp. Vui lòng thử lại sau hoặc báo quản trị viên."),
            errorCount: 1,
            finishedAt: new Date(),
          })
          .where(eq(importJobs.id, importId));
        const [failed] = await deps.db.select().from(importJobs).where(eq(importJobs.id, importId));
        if (failed) await notifyOutcome(deps, failed, "FAILED", { errorCount: 1 });
      }
      throw err;
    }
  };
}
