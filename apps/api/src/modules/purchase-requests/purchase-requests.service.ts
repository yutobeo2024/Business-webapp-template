import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { Queue } from "bullmq";
import { purchaseRequests, users, type Db, type DbOrTx } from "@app/db";
import {
  can,
  calcTotal,
  type CreatePurchaseRequestInput,
  type CurrentUser,
  JOBS,
  type ListPurchaseRequestsQuery,
  type Paginated,
  type PrStatusChangedJob,
  type PurchaseRequestDto,
  type TransitionPurchaseRequestInput,
  type UpdatePurchaseRequestInput,
} from "@app/shared";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { DB } from "../../db/db.module.js";
import { enqueueAfterCommit, NOTIFICATIONS_QUEUE } from "../../queue/queue.module.js";
import {
  canView,
  findViewablePurchaseRequest,
  listPurchaseRequests,
  viewScope,
  nextDocumentCode,
} from "@app/server";
import { canManageAttachments } from "./attachments.service.js";
import { allowedEvents, decide } from "./state-machine.js";

type PrRow = typeof purchaseRequests.$inferSelect;

const ENTITY = "purchase_request";

@Injectable()
export class PurchaseRequestsService {
  private readonly logger = new Logger(PurchaseRequestsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(NOTIFICATIONS_QUEUE) private readonly notifications: Pick<Queue, "add">,
  ) {}

  private toDto(row: PrRow, requesterName: string, actor: CurrentUser): PurchaseRequestDto {
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      totalAmount: row.totalAmount,
      items: row.items,
      note: row.note,
      rejectReason: row.rejectReason,
      requesterId: row.requesterId,
      requesterName,
      departmentId: row.departmentId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedEvents: allowedEvents(row, actor),
      canManageAttachments: canManageAttachments(row, actor),
    };
  }

  async create(
    actor: CurrentUser,
    input: CreatePurchaseRequestInput,
    ip: string | null,
  ): Promise<PurchaseRequestDto> {
    // Controller đã gắn @RequirePermission("pr.create"); kiểm lại ở service vì service còn được gọi từ nơi khác (job, test).
    if (!can(actor, "pr.create")) throw Errors.forbidden("Bạn không có quyền lập phiếu đề nghị mua hàng");
    if (!actor.departmentId) {
      throw new BusinessError(
        "PR_NO_DEPARTMENT",
        "Tài khoản chưa được gán phòng ban, không thể lập phiếu",
        422,
      );
    }
    const departmentId = actor.departmentId;
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchaseRequests)
        .values({
          code: await nextDocumentCode(tx, "PR"),
          title: input.title,
          items: input.items,
          note: input.note ?? null,
          totalAmount: calcTotal(input.items),
          departmentId,
          requesterId: actor.id,
        })
        .returning();
      if (!created) throw new Error("Insert purchase_request không trả về dòng");
      await writeAudit(tx, {
        actorId: actor.id,
        action: "pr.create",
        entityType: ENTITY,
        entityId: created.id,
        after: created,
        ip,
      });
      return created;
    });
    return this.toDto(row, actor.fullName, actor);
  }

  async list(actor: CurrentUser, q: ListPurchaseRequestsQuery): Promise<Paginated<PurchaseRequestDto>> {
    const page = await listPurchaseRequests(this.db, actor, q);
    return { ...page, items: page.items.map((r) => this.toDto(r.pr, r.requesterName, actor)) };
  }

  async get(actor: CurrentUser, id: string): Promise<PurchaseRequestDto> {
    const r = await findViewablePurchaseRequest(this.db, actor, id);
    if (!r) throw Errors.notFound("PR");
    return this.toDto(r.pr, r.requesterName, actor);
  }

  /** BR-01: chỉ người tạo sửa được, chỉ ở trạng thái Nháp. */
  async update(
    actor: CurrentUser,
    id: string,
    input: UpdatePurchaseRequestInput,
    ip: string | null,
  ): Promise<PurchaseRequestDto> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lockForWrite(tx, actor, id, input.version);
      if (current.requesterId !== actor.id || !can(actor, "pr.create")) {
        throw Errors.forbidden("Chỉ người lập phiếu (còn quyền lập phiếu) được sửa phiếu");
      }
      if (current.status !== "DRAFT") {
        throw new BusinessError("PR_NOT_EDITABLE", "Chỉ sửa được phiếu ở trạng thái Nháp", 409);
      }
      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          title: input.title,
          items: input.items,
          note: input.note ?? null,
          totalAmount: calcTotal(input.items),
          version: current.version + 1,
        })
        .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.version, input.version)))
        .returning();
      if (!updated) throw Errors.versionConflict();
      await writeAudit(tx, {
        actorId: actor.id,
        action: "pr.update",
        entityType: ENTITY,
        entityId: id,
        before: current,
        after: updated,
        ip,
      });
      return updated;
    });
    return this.toDto(row, actor.fullName, actor);
  }

  /** BR-06: khóa dòng (FOR UPDATE) + kiểm tra version + audit trong cùng transaction. */
  async transition(
    actor: CurrentUser,
    id: string,
    input: TransitionPurchaseRequestInput,
    ip: string | null,
  ): Promise<PurchaseRequestDto> {
    const { row, from } = await this.db.transaction(async (tx) => {
      const current = await this.lockForWrite(tx, actor, id, input.version);
      const decision = decide(current, input.event, actor);
      if (!decision.ok) throw decision.error;

      const [updated] = await tx
        .update(purchaseRequests)
        .set({
          status: decision.to,
          version: current.version + 1,
          rejectReason:
            input.event === "REJECT"
              ? (input.reason ?? null)
              : input.event === "REVISE"
                ? null
                : current.rejectReason,
        })
        .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.version, input.version)))
        .returning();
      if (!updated) throw Errors.versionConflict();

      await writeAudit(tx, {
        actorId: actor.id,
        action: `pr.${input.event.toLowerCase()}`,
        entityType: ENTITY,
        entityId: id,
        before: { status: current.status, version: current.version },
        after: { status: updated.status, version: updated.version, reason: input.reason ?? null },
        ip,
      });
      return { row: updated, from: current.status };
    });

    // Gửi thông báo SAU khi commit. Lỗi hàng đợi không làm hỏng thao tác nghiệp vụ đã thành công.
    // jobId theo version để không gửi trùng khi client gửi lại.
    const job: PrStatusChangedJob = {
      purchaseRequestId: row.id,
      code: row.code,
      from,
      to: row.status,
      actorId: actor.id,
      version: row.version,
    };
    await enqueueAfterCommit(this.notifications, JOBS.prStatusChanged, job, {
      jobId: `pr-${row.id}-v${row.version}`,
    }).catch((err: unknown) => this.logger.error({ err, prId: row.id }, "Không đẩy được job thông báo"));

    const [requester] = await this.db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, row.requesterId));
    return this.toDto(row, requester?.fullName ?? "", actor);
  }

  private async lockForWrite(
    tx: DbOrTx,
    actor: CurrentUser,
    id: string,
    expectedVersion: number,
  ): Promise<PrRow> {
    const [current] = await tx
      .select()
      .from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, id), isNull(purchaseRequests.deletedAt)))
      .for("update");
    if (!current || !canView(viewScope(actor), current)) throw Errors.notFound("PR");
    if (current.version !== expectedVersion) throw Errors.versionConflict();
    return current;
  }
}
