import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type Permission } from "@app/shared";
import { Errors } from "../common/business-error.js";
import type { AuthedRequest } from "../common/request-context.js";

export { type Access, loadAccess } from "@app/server";

const REQUIRED = "requiredPermissions";

/**
 * Endpoint yêu cầu MỌI quyền liệt kê. Gắn ở controller hoặc từng handler.
 * Quyền ở mức hành động trong một bản ghi (duyệt phiếu của phòng nào...) vẫn kiểm trong state machine/policy.
 */
export const RequirePermission = (...permissions: Permission[]): CustomDecorator =>
  SetMetadata(REQUIRED, permissions);

/** Chạy sau SessionGuard (đã có req.user). Thiếu quyền: 403. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<Permission[]>(REQUIRED, [
      ctx.getClass(),
      ctx.getHandler(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !required.every((p) => can(user, p))) throw Errors.forbidden();
    return true;
  }
}
