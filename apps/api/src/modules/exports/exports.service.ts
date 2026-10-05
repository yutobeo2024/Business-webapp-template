/**
 * Xuất file chạy nền (spec 002). API chỉ kiểm quyền, ghi yêu cầu + audit, đẩy job SAU commit; worker tạo file
 * (apps/worker/src/exports/). Chỉ người yêu cầu xem và tải được kết quả của mình.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Response } from "express";
import { exportJobs, files, users, type Db } from "@app/db";
import type { FileStorage } from "@app/server";
import { findViewablePurchaseRequest } from "@app/server"; // sample
import {
  can,
  type CreateExportInput,
  type CurrentUser,
  EXPORT_MAX_ACTIVE_PER_USER,
  EXPORT_TYPES,
  type ExportJobDto,
  type ExportRunJob,
  type ExportType,
  JOBS,
} from "@app/shared";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { DB } from "../../db/db.module.js";
import { sendFile, STORAGE } from "../../files/files.module.js";
import { enqueueAfterCommit, EXPORTS_QUEUE } from "../../queue/queue.module.js";

const ENTITY = "export_job";
type ExportRow = typeof exportJobs.$inferSelect;

function isExportType(type: string): type is ExportType {
  return Object.hasOwn(EXPORT_TYPES, type);
}

function toDto(row: ExportRow, fileName: string | null, now = new Date()): ExportJobDto {
  const type = row.type as ExportType;
  return {
    id: row.id,
    type,
    label: isExportType(row.type) ? EXPORT_TYPES[type].label : row.type,
    status: row.status,
    rowCount: row.rowCount,
    error: row.error,
    fileName,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    downloadable: row.status === "DONE" && row.fileId !== null && !!row.expiresAt && row.expiresAt > now,
  };
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: FileStorage,
    @Inject(EXPORTS_QUEUE) private readonly queue: Pick<Queue, "add">,
  ) {}

  /**
   * Kiểm quyền TRƯỚC khi xếp hàng (worker kiểm lại lúc chạy). Thêm loại xuất mới: thêm nhánh ở đây nếu cần kiểm phạm vi
   * (ví dụ in một bản ghi: ngoài phạm vi xem thì 404).
   */
  private async assertCanRequest(actor: CurrentUser, input: CreateExportInput): Promise<void> {
    const def = EXPORT_TYPES[input.type];
    if (def.permission && !can(actor, def.permission)) {
      throw Errors.forbidden("Bạn không có quyền xuất dữ liệu này");
    }
    switch (input.type) {
      case "admin.users.xlsx":
        return; // quyền users.manage đã kiểm ở trên, không có phạm vi riêng
      // sample:begin
      case "purchase-request.pdf":
        if (!(await findViewablePurchaseRequest(this.db, actor, input.params.id)))
          throw Errors.notFound("PR");
        return;
      case "purchase-requests.xlsx":
        return; // phạm vi xem áp ở truy vấn trong worker
      // sample:end
    }
  }

  async request(actor: CurrentUser, input: CreateExportInput, ip: string | null): Promise<ExportJobDto> {
    await this.assertCanRequest(actor, input);
    const row = await this.db.transaction(async (tx) => {
      // Khóa dòng người dùng: hai yêu cầu song song không cùng lọt qua giới hạn số lần xuất đang chạy.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).for("update");
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(exportJobs)
        .where(and(eq(exportJobs.requestedBy, actor.id), inArray(exportJobs.status, ["QUEUED", "RUNNING"])));
      if (n >= EXPORT_MAX_ACTIVE_PER_USER) {
        throw new BusinessError(
          "EXPORT_TOO_MANY",
          `Bạn đang có ${n} lần xuất chưa xong. Chờ xong rồi xuất tiếp.`,
          429,
        );
      }
      const [created] = await tx
        .insert(exportJobs)
        .values({ type: input.type, params: input.params, requestedBy: actor.id })
        .returning();
      if (!created) throw new Error("Insert export_jobs không trả về dòng");
      await writeAudit(tx, {
        actorId: actor.id,
        action: "export.request",
        entityType: ENTITY,
        entityId: created.id,
        after: { type: input.type, params: input.params },
        ip,
      });
      return created;
    });

    const job: ExportRunJob = { exportId: row.id };
    try {
      await enqueueAfterCommit(this.queue, JOBS.exportRun, job, { jobId: `export-${row.id}` });
      return toDto(row, null);
    } catch (err) {
      // Không xếp hàng được: báo lỗi rõ thay vì để "Đang chờ" mãi. Nếu lệnh vẫn tới Redis sau đó, worker thấy FAILED và bỏ qua.
      this.logger.error({ err, exportId: row.id }, "Không đẩy được job xuất file");
      const [failed] = await this.db
        .update(exportJobs)
        .set({
          status: "FAILED",
          error: "Hệ thống bận, chưa xếp được yêu cầu xuất. Vui lòng thử lại.",
          finishedAt: new Date(),
        })
        .where(and(eq(exportJobs.id, row.id), eq(exportJobs.status, "QUEUED")))
        .returning();
      return toDto(failed ?? row, null);
    }
  }

  /** 20 lần xuất gần nhất của chính người dùng. */
  async listMine(actor: CurrentUser): Promise<ExportJobDto[]> {
    const rows = await this.db
      .select({ job: exportJobs, fileName: files.originalName })
      .from(exportJobs)
      .leftJoin(files, eq(files.id, exportJobs.fileId))
      .where(eq(exportJobs.requestedBy, actor.id))
      .orderBy(desc(exportJobs.createdAt), desc(exportJobs.id))
      .limit(20);
    return rows.map((r) => toDto(r.job, r.fileName));
  }

  async get(actor: CurrentUser, id: string): Promise<ExportJobDto> {
    const r = await this.findMine(actor, id);
    return toDto(r.job, r.fileName);
  }

  async download(actor: CurrentUser, id: string, res: Response, ip: string | null): Promise<void> {
    const { job } = await this.findMine(actor, id);
    if (job.status !== "DONE") {
      throw new BusinessError("EXPORT_NOT_READY", "Tệp chưa tạo xong", 409);
    }
    const [file] = job.fileId ? await this.db.select().from(files).where(eq(files.id, job.fileId)) : [];
    if (!file || file.deletedAt || !job.expiresAt || job.expiresAt <= new Date()) {
      throw new BusinessError("EXPORT_EXPIRED", "Tệp đã hết hạn tải về. Vui lòng xuất lại.", 410);
    }
    await writeAudit(this.db, {
      actorId: actor.id,
      action: "export.download",
      entityType: ENTITY,
      entityId: job.id,
      after: { type: job.type, fileId: file.id, rowCount: job.rowCount },
      ip,
    });
    await sendFile(this.storage, res, file);
  }

  /** Lần xuất của người khác: 404 (không lộ là có tồn tại). */
  private async findMine(actor: CurrentUser, id: string) {
    const [r] = await this.db
      .select({ job: exportJobs, fileName: files.originalName })
      .from(exportJobs)
      .leftJoin(files, eq(files.id, exportJobs.fileId))
      .where(and(eq(exportJobs.id, id), eq(exportJobs.requestedBy, actor.id)));
    if (!r) throw Errors.notFound("EXPORT");
    return r;
  }
}
