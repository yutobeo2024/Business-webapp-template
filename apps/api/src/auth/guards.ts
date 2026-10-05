import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { CookieOptions, Response } from "express";
import { BusinessError, Errors } from "../common/business-error.js";
import type { AuthedRequest } from "../common/request-context.js";
import { ENV, type Env } from "../config/env.js";
import { AuthService } from "./auth.service.js";
import { ALLOW_PASSWORD_CHANGE, IS_PUBLIC } from "./decorators.js";

export const SESSION_COOKIE = "sid";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Thuộc tính cookie phiên, dùng chung lúc đăng nhập và lúc gia hạn. Secure theo giao thức của APP_ORIGIN. */
export function sessionCookieOptions(env: Env, expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.APP_ORIGIN.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires,
  };
}

/**
 * Chống CSRF: request thay đổi dữ liệu phải có Origin (hoặc Referer) trùng APP_ORIGIN.
 * Kết hợp cookie SameSite=Lax. Client không phải trình duyệt phải gửi header Origin.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (requestOrigin(req.get("origin"), req.get("referer")) === this.env.APP_ORIGIN) return true;
    throw new BusinessError("CSRF_REJECTED", "Yêu cầu không hợp lệ (nguồn gửi không được phép)", 403);
  }
}

/** Origin của request; Referer sai định dạng coi như không có (bị chặn 403, không thành lỗi 500). */
function requestOrigin(origin: string | undefined, referer: string | undefined): string | undefined {
  if (origin) return origin;
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/** Mặc định MỌI endpoint yêu cầu đăng nhập. Endpoint công khai phải gắn @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || token.length < 20) throw Errors.unauthenticated();
    const result = await this.auth.validate(token);
    if (!result) throw Errors.unauthenticated();
    req.user = result.user;
    req.sessionTokenHash = result.tokenHash;
    // Phiên trượt vừa được gia hạn trong DB: gia hạn cả cookie, nếu không trình duyệt tự xóa cookie đúng
    // SESSION_TTL_HOURS sau khi đăng nhập dù người dùng vẫn đang làm việc.
    if (result.renewedExpiresAt) {
      http
        .getResponse<Response>()
        .cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env, result.renewedExpiresAt));
    }
    if (
      result.user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, [ctx.getHandler(), ctx.getClass()])
    ) {
      throw new BusinessError(
        "AUTH_PASSWORD_CHANGE_REQUIRED",
        "Tài khoản đang dùng mật khẩu tạm. Hãy đổi mật khẩu trước khi tiếp tục.",
        403,
      );
    }
    return true;
  }
}
