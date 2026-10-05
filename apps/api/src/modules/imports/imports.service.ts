/**
 * Nhập Excel hai bước (spec 003). API chỉ nhận tệp, kiểm quyền, ghi yêu cầu + audit, đẩy job SAU commit; worker kiểm và
 * ghi (apps/worker/src/imports). Chỉ người tải lên xem, xác nhận, hủy được.
 */
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { files, importJobs, type Db } from "@app/db";
import {
  buildImportTemplate,
  contentDisposition,
  type FileStorage,
  storeFile,
  withStoredFile,
} from "@app/server";
import {
  can,
  type CurrentUser,
  IMPORT_TYPES,
  type ImportJobDto,
  type ImportJobPayload,
  type ImportType,
  JOBS,
} from "@app/shared";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { ENV, type Env } from "../../config/env.js";
import { DB } from "../../db/db.module.js";
import { STORAGE, toHttpFileError } from "../../files/files.module.js";
import { enqueueAfterCommit, IMPORTS_QUEUE } from "../../queue/queue.module.js";

const ENTITY = "import_job";
type ImportRow = typeof importJobs.$inferSelect;

function toDto(row: ImportRow, fileName: string | null): ImportJobDto {
  const type = row.type as ImportType;
  return {
    id: row.id,
    type,
    label: IMPORT_TYPES[type]?.label ?? row.type,
    status: row.status,
    fileName,
    totalRows: row.totalRows,
    errorCount: row.errorCount,
    errors: row.errors,
    preview: row.preview,
    importedCount: row.importedCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: FileStorage,
    @Inject(ENV) private readonly env: Env,
    @Inject(IMPORTS_QUEUE) private readonly queue: Pick<Queue, "add">,
  ) {}

  private assertCan(actor: CurrentUser, type: ImportType): void {
    if (!can(actor, IMPORT_TYPES[type].permission))
      throw Errors.forbidden("Bạn không có quyền nhập dữ liệu này");
  }

  async sendTemplate(actor: CurrentUser, type: ImportType, res: Response): Promise<void> {
    this.assertCan(actor, type);
    const buf = await buildImportTemplate(type);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(`mau-nhap-${type}.xlsx`));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.end(buf);
  }

  async upload(
    actor: CurrentUser,
    type: ImportType,
    upload: { buffer: Buffer; originalname: string } | undefined,
    ip: string | null,
  ): Promise<ImportJobDto> {
    this.assertCan(actor, type);
    if (!upload) throw new BusinessError("FILE_MISSING", "Chưa chọn tệp", 400);
    const id = randomUUID();
    let created: { row: ImportRow; fileName: string };
    try {
      created = await withStoredFile(this.storage, (storage) =>
        this.db.transaction(async (tx) => {
          const { row: file } = await storeFile(tx, storage, {
            buffer: upload.buffer,
            originalName: upload.originalname,
            allowed: ["xlsx"],
            maxBytes: this.env.FILE_MAX_MB * 1024 * 1024,
            uploadedBy: actor.id,
            entityType: ENTITY,
            entityId: id,
          });
          const [row] = await tx
            .insert(importJobs)
            .values({ id, type, fileId: file.id, requestedBy: actor.id })
            .returning();
          await writeAudit(tx, {
            actorId: actor.id,
            action: "import.upload",
            entityType: ENTITY,
            entityId: id,
            after: { type, fileId: file.id, name: file.originalName, sha256: file.sha256 },
            ip,
          });
          return { row: row!, fileName: file.originalName };
        }),
      );
    } catch (err) {
      throw toHttpFileError(err);
    }
    await this.enqueue(JOBS.importValidate, id, "VALIDATING");
    return toDto(created.row, created.fileName);
  }

  async get(actor: CurrentUser, id: string): Promise<ImportJobDto> {
    const { job, fileName } = await this.findMine(actor, id);
    return toDto(job, fileName);
  }

  /** Chỉ khi READY; khóa dòng để bấm hai lần chỉ ghi một lần. */
  async commit(actor: CurrentUser, id: string, ip: string | null): Promise<ImportJobDto> {
    const { fileName } = await this.findMine(actor, id);
    const row = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.id, id), eq(importJobs.requestedBy, actor.id)))
        .for("update");
      if (!job) throw Errors.notFound("IMPORT");
      this.assertCan(actor, job.type as ImportType);
      if (job.status !== "READY") {
        throw new BusinessError(
          "IMPORT_NOT_READY",
          "Tệp chưa sẵn sàng để nhập (đang kiểm, có lỗi hoặc đã nhập)",
          409,
        );
      }
      const [updated] = await tx
        .update(importJobs)
        .set({ status: "COMMITTING" })
        .where(eq(importJobs.id, id))
        .returning();
      await writeAudit(tx, {
        actorId: actor.id,
        action: "import.confirm",
        entityType: ENTITY,
        entityId: id,
        after: { type: job.type, totalRows: job.totalRows },
        ip,
      });
      return updated!;
    });
    await this.enqueue(JOBS.importCommit, id, "COMMITTING");
    return toDto(row, fileName);
  }

  async cancel(actor: CurrentUser, id: string): Promise<ImportJobDto> {
    const { job, fileName } = await this.findMine(actor, id);
    this.assertCan(actor, job.type as ImportType);
    const [row] = await this.db
      .update(importJobs)
      .set({ status: "CANCELLED", finishedAt: new Date() })
      .where(and(eq(importJobs.id, id), eq(importJobs.requestedBy, actor.id), eq(importJobs.status, "READY")))
      .returning();
    if (!row) throw new BusinessError("IMPORT_NOT_CANCELLABLE", "Chỉ hủy được tệp đang chờ xác nhận", 409);
    return toDto(row, fileName);
  }

  /** Đẩy job sau commit; không đẩy được thì đánh dấu lỗi rõ ràng thay vì để "đang xử lý" mãi. */
  private async enqueue(name: string, id: string, from: "VALIDATING" | "COMMITTING"): Promise<void> {
    const job: ImportJobPayload = { importId: id };
    try {
      await enqueueAfterCommit(this.queue, name, job, { jobId: `${name}-${id}` });
    } catch (err) {
      this.logger.error({ err, importId: id }, "Không đẩy được job nhập Excel");
      await this.db
        .update(importJobs)
        .set({
          status: from === "VALIDATING" ? "FAILED" : "READY",
          errors:
            from === "VALIDATING"
              ? [{ row: null, column: null, message: "Hệ thống bận, chưa kiểm được tệp. Vui lòng tải lại." }]
              : [],
        })
        .where(and(eq(importJobs.id, id), eq(importJobs.status, from)));
      throw new BusinessError("IMPORT_QUEUE_BUSY", "Hệ thống bận, vui lòng thử lại sau ít phút", 503);
    }
  }

  private async findMine(actor: CurrentUser, id: string) {
    const [r] = await this.db
      .select({ job: importJobs, fileName: files.originalName })
      .from(importJobs)
      .leftJoin(files, eq(files.id, importJobs.fileId))
      .where(and(eq(importJobs.id, id), eq(importJobs.requestedBy, actor.id)));
    if (!r) throw Errors.notFound("IMPORT");
    return r;
  }
}
