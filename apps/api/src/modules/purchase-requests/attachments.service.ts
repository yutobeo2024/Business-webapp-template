/**
 * Đính kèm của phiếu đề nghị (BR-09, spec 001). Mẫu dùng lõi tệp (spec 002): kiểm quyền theo bản ghi chứa tệp, lưu bằng
 * storeFile trong transaction có audit, tải về bằng sendFile.
 */
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Response } from "express";
import { files, purchaseRequests, type Db, type DbOrTx } from "@app/db";
import {
  canView,
  findViewablePurchaseRequest,
  storeFile,
  toFileDto,
  viewScope,
  withStoredFile,
  type FileStorage,
} from "@app/server";
import {
  can,
  type CurrentUser,
  type FileDto,
  PR_ATTACHMENT_EDITABLE_STATUSES,
  PR_ATTACHMENT_LIMIT,
  PR_ATTACHMENT_TYPES,
} from "@app/shared";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { ENV, type Env } from "../../config/env.js";
import { DB } from "../../db/db.module.js";
import { sendFile, STORAGE, toHttpFileError } from "../../files/files.module.js";

const ENTITY = "purchase_request";
type PrRow = typeof purchaseRequests.$inferSelect;

/** BR-09: người lập (còn pr.create) thêm/xóa đính kèm khi phiếu Nháp hoặc Bị từ chối. */
export function canManageAttachments(pr: Pick<PrRow, "requesterId" | "status">, actor: CurrentUser): boolean {
  return (
    pr.requesterId === actor.id &&
    can(actor, "pr.create") &&
    PR_ATTACHMENT_EDITABLE_STATUSES.includes(pr.status)
  );
}

@Injectable()
export class PurchaseRequestAttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: FileStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(actor: CurrentUser, prId: string): Promise<FileDto[]> {
    if (!(await findViewablePurchaseRequest(this.db, actor, prId))) throw Errors.notFound("PR");
    const rows = await this.db
      .select()
      .from(files)
      .where(and(eq(files.entityType, ENTITY), eq(files.entityId, prId), isNull(files.deletedAt)))
      .orderBy(files.createdAt);
    return rows.map(toFileDto);
  }

  async add(
    actor: CurrentUser,
    prId: string,
    upload: { buffer: Buffer; originalname: string } | undefined,
    ip: string | null,
  ): Promise<FileDto> {
    if (!upload) throw new BusinessError("FILE_MISSING", "Chưa chọn tệp", 400);
    try {
      return await withStoredFile(this.storage, (storage) =>
        this.db.transaction(async (tx) => {
          await this.lockManageable(tx, actor, prId);
          const [{ n } = { n: 0 }] = await tx
            .select({ n: count() })
            .from(files)
            .where(and(eq(files.entityType, ENTITY), eq(files.entityId, prId), isNull(files.deletedAt)));
          if (n >= PR_ATTACHMENT_LIMIT) {
            throw new BusinessError(
              "PR_ATTACHMENT_LIMIT",
              `Mỗi phiếu tối đa ${PR_ATTACHMENT_LIMIT} tệp đính kèm`,
              409,
            );
          }
          const { row, dto } = await storeFile(tx, storage, {
            buffer: upload.buffer,
            originalName: upload.originalname,
            allowed: PR_ATTACHMENT_TYPES,
            maxBytes: this.env.FILE_MAX_MB * 1024 * 1024,
            uploadedBy: actor.id,
            entityType: ENTITY,
            entityId: prId,
          });
          await writeAudit(tx, {
            actorId: actor.id,
            action: "pr.attachment_add",
            entityType: ENTITY,
            entityId: prId,
            after: { fileId: row.id, name: row.originalName, sizeBytes: row.sizeBytes, sha256: row.sha256 },
            ip,
          });
          return dto;
        }),
      );
    } catch (err) {
      throw toHttpFileError(err);
    }
  }

  /** Xóa mềm (tệp vật lý được job dọn dẹp xóa sau 7 ngày). */
  async remove(actor: CurrentUser, prId: string, fileId: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockManageable(tx, actor, prId);
      const [deleted] = await tx
        .update(files)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(files.id, fileId),
            eq(files.entityType, ENTITY),
            eq(files.entityId, prId),
            isNull(files.deletedAt),
          ),
        )
        .returning();
      if (!deleted) throw Errors.notFound("FILE");
      await writeAudit(tx, {
        actorId: actor.id,
        action: "pr.attachment_remove",
        entityType: ENTITY,
        entityId: prId,
        // storageKey: sau 7 ngày hàng files bị dọn, đây là cách duy nhất tìm lại tệp trong bản sao lưu (runbook).
        before: { fileId, name: deleted.originalName, storageKey: deleted.storageKey },
        ip,
      });
    });
  }

  async download(actor: CurrentUser, prId: string, fileId: string, res: Response): Promise<void> {
    if (!(await findViewablePurchaseRequest(this.db, actor, prId))) throw Errors.notFound("PR");
    const [file] = await this.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          eq(files.entityType, ENTITY),
          eq(files.entityId, prId),
          isNull(files.deletedAt),
        ),
      );
    if (!file) throw Errors.notFound("FILE");
    await sendFile(this.storage, res, file);
  }

  /** Khóa dòng phiếu (xếp hàng với chuyển trạng thái), kiểm phạm vi xem (404) rồi quyền thêm/xóa đính kèm. */
  private async lockManageable(tx: DbOrTx, actor: CurrentUser, prId: string): Promise<PrRow> {
    const [pr] = await tx
      .select()
      .from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, prId), isNull(purchaseRequests.deletedAt)))
      .for("update");
    if (!pr || !canView(viewScope(actor), pr)) throw Errors.notFound("PR");
    if (pr.requesterId !== actor.id || !can(actor, "pr.create")) {
      throw Errors.forbidden("Chỉ người lập phiếu được thêm hoặc xóa tệp đính kèm");
    }
    if (!PR_ATTACHMENT_EDITABLE_STATUSES.includes(pr.status)) {
      throw new BusinessError(
        "PR_NOT_EDITABLE",
        "Phiếu đã gửi duyệt: không thêm hoặc xóa tệp đính kèm được nữa",
        409,
      );
    }
    return pr;
  }
}
