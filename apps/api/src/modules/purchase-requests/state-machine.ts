/**
 * State machine phiếu đề nghị mua hàng. Bảng chuyển trạng thái khai báo tường minh, là nguồn sự thật duy nhất
 * cho việc ai được làm gì ở trạng thái nào. Hàm thuần (không đụng DB) để test đầy đủ từng quy tắc.
 * Spec: docs/specs/001-phieu-de-nghi-mua-hang.md
 */
import {
  type CurrentUser,
  DIRECTOR_APPROVAL_THRESHOLD_VND,
  PR_EVENTS,
  type PrEvent,
  type PrStatus,
  can,
  type Permission,
} from "@app/shared";
import { BusinessError, Errors } from "../../common/business-error.js";

export interface PrSnapshot {
  status: PrStatus;
  totalAmount: number;
  requesterId: string;
  departmentId: string;
}

type Actor = Pick<CurrentUser, "id" | "departmentId" | "permissions">;

interface TransitionRule {
  from: readonly PrStatus[];
  /**
   * "REQUESTER" = người tạo phiếu VÀ vẫn có pr.create (bị thu quyền thì không gửi/sửa/hủy phiếu cũ được nữa).
   * Còn lại: quyền cần có (không kiểm tên vai trò, ADR-0004).
   */
  who: "REQUESTER" | Permission;
  /** Kiểm tra thêm ngoài quyền. Trả về lỗi nếu vi phạm. */
  check?: (pr: PrSnapshot, actor: Actor) => BusinessError | null;
  to: (pr: PrSnapshot, actor: Actor) => PrStatus;
}

const invalidTransition = () =>
  new BusinessError("PR_INVALID_TRANSITION", "Thao tác không hợp lệ ở trạng thái hiện tại của phiếu", 409);

const notSelf = (pr: PrSnapshot, actor: Actor) =>
  actor.id === pr.requesterId
    ? new BusinessError("PR_SELF_APPROVAL", "Không được tự duyệt hoặc từ chối phiếu của chính mình", 403)
    : null;

const sameDepartment = (pr: PrSnapshot, actor: Actor) =>
  actor.departmentId !== pr.departmentId
    ? Errors.forbidden("Chỉ trưởng phòng của phòng ban lập phiếu được xử lý phiếu này")
    : null;

export const TRANSITIONS: Record<PrEvent, TransitionRule[]> = {
  // BR-01: chỉ người tạo được gửi phiếu nháp.
  // BR-08: phiếu do người có quyền duyệt cấp phòng lập (trưởng phòng) đi thẳng lên cấp cuối: không ai tự duyệt phiếu
  // của mình, nên bước duyệt cấp phòng sẽ không có người xử lý và phiếu kẹt vĩnh viễn.
  SUBMIT: [
    {
      from: ["DRAFT"],
      who: "REQUESTER",
      to: (_pr, actor) => (can(actor, "pr.approve.department") ? "PENDING_DIRECTOR" : "PENDING_MANAGER"),
    },
  ],
  // BR-02 + BR-03
  MANAGER_APPROVE: [
    {
      from: ["PENDING_MANAGER"],
      who: "pr.approve.department",
      check: (pr, a) => notSelf(pr, a) ?? sameDepartment(pr, a),
      to: (pr) => (pr.totalAmount > DIRECTOR_APPROVAL_THRESHOLD_VND ? "PENDING_DIRECTOR" : "APPROVED"),
    },
  ],
  DIRECTOR_APPROVE: [
    { from: ["PENDING_DIRECTOR"], who: "pr.approve.final", check: notSelf, to: () => "APPROVED" },
  ],
  // BR-04: lý do từ chối được kiểm tra ở schema (transitionPurchaseRequestSchema)
  REJECT: [
    {
      from: ["PENDING_MANAGER"],
      who: "pr.approve.department",
      check: (pr, a) => notSelf(pr, a) ?? sameDepartment(pr, a),
      to: () => "REJECTED",
    },
    { from: ["PENDING_DIRECTOR"], who: "pr.approve.final", check: notSelf, to: () => "REJECTED" },
  ],
  REVISE: [{ from: ["REJECTED"], who: "REQUESTER", to: () => "DRAFT" }],
  // BR-05
  CANCEL: [
    { from: ["DRAFT", "PENDING_MANAGER"], who: "REQUESTER", to: () => "CANCELLED" },
    // BR-08: trưởng phòng hủy được phiếu của mình khi còn chờ cấp duyệt đầu tiên (với họ là giám đốc).
    {
      from: ["PENDING_DIRECTOR"],
      who: "REQUESTER",
      check: (_pr, actor) => (can(actor, "pr.approve.department") ? null : invalidTransition()),
      to: () => "CANCELLED",
    },
  ],
};

export type Decision = { ok: true; to: PrStatus } | { ok: false; error: BusinessError };

export function decide(pr: PrSnapshot, event: PrEvent, actor: Actor): Decision {
  const rules = TRANSITIONS[event].filter((r) => r.from.includes(pr.status));
  if (rules.length === 0) {
    return { ok: false, error: invalidTransition() };
  }
  let lastError: BusinessError = Errors.forbidden();
  for (const rule of rules) {
    const allowedWho =
      rule.who === "REQUESTER"
        ? actor.id === pr.requesterId && can(actor, "pr.create")
        : can(actor, rule.who);
    if (!allowedWho) {
      lastError = Errors.forbidden();
      continue;
    }
    const err = rule.check?.(pr, actor) ?? null;
    if (err) {
      lastError = err;
      continue;
    }
    return { ok: true, to: rule.to(pr, actor) };
  }
  return { ok: false, error: lastError };
}

/** Các sự kiện actor được phép thực hiện, để UI hiển thị nút. Backend vẫn gọi decide() khi thực thi. */
export function allowedEvents(pr: PrSnapshot, actor: Actor): PrEvent[] {
  return PR_EVENTS.filter((e) => decide(pr, e, actor).ok);
}
