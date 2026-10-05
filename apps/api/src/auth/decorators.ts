import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { CurrentUser as CurrentUserType } from "@app/shared";
import { Errors } from "../common/business-error.js";
import type { AuthedRequest } from "../common/request-context.js";

export const IS_PUBLIC = "isPublic";
/** Đánh dấu endpoint không cần đăng nhập. Mặc định mọi endpoint đều yêu cầu đăng nhập. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PASSWORD_CHANGE = "allowDuringPasswordChange";
/**
 * Endpoint vẫn dùng được khi tài khoản đang ở mật khẩu tạm (mustChangePassword). Chỉ gắn cho me, đổi mật khẩu,
 * đăng xuất: mọi endpoint khác trả 403 AUTH_PASSWORD_CHANGE_REQUIRED cho tới khi đổi xong.
 */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserType => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  // Chỉ xảy ra khi dùng @CurrentUser() trên endpoint @Public(): coi như chưa đăng nhập.
  if (!user) throw Errors.unauthenticated();
  return user;
});
