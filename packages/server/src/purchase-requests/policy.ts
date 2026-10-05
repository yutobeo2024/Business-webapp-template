/**
 * Phạm vi dữ liệu theo quyền (BR-07). Áp dụng ở tầng query để chống IDOR:
 * người không có quyền xem sẽ nhận 404 như thể phiếu không tồn tại.
 */
import { can, type CurrentUser } from "@app/shared";

export type ViewScope =
  | { kind: "all" }
  | { kind: "department"; departmentId: string; userId: string }
  | { kind: "own"; userId: string };

/** Quyền có cấp: pr.view.all > pr.view.department > mặc định chỉ phiếu của chính mình. */
export function viewScope(actor: Pick<CurrentUser, "id" | "departmentId" | "permissions">): ViewScope {
  if (can(actor, "pr.view.all")) return { kind: "all" };
  if (can(actor, "pr.view.department") && actor.departmentId) {
    return { kind: "department", departmentId: actor.departmentId, userId: actor.id };
  }
  return { kind: "own", userId: actor.id };
}

export function canView(scope: ViewScope, pr: { requesterId: string; departmentId: string }): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "department":
      return pr.departmentId === scope.departmentId || pr.requesterId === scope.userId;
    case "own":
      return pr.requesterId === scope.userId;
  }
}
