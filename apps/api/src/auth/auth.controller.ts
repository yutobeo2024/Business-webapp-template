import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import {
  type ChangePasswordInput,
  changePasswordSchema,
  type CurrentUser as CurrentUserType,
  type LoginInput,
  loginSchema,
} from "@app/shared";
import { type AuthedRequest, clientIp } from "../common/request-context.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { ENV, type Env } from "../config/env.js";
import { AuthService } from "./auth.service.js";
import { AllowDuringPasswordChange, CurrentUser, Public } from "./decorators.js";
import { SESSION_COOKIE, sessionCookieOptions } from "./guards.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserType> {
    const result = await this.auth.login(body, {
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
    });
    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(this.env, result.expiresAt));
    return result.user;
  }

  /** Tự đổi mật khẩu. Throttle chặt: endpoint này kiểm mật khẩu hiện tại, dễ bị dùng để dò mật khẩu. */
  @AllowDuringPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.auth.changePassword(user, req.sessionTokenHash!, body, clientIp(req));
  }

  @AllowDuringPasswordChange()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @CurrentUser() user: CurrentUserType,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.sessionTokenHash) await this.auth.logout(req.sessionTokenHash, user.id, clientIp(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @AllowDuringPasswordChange()
  @Get("me")
  me(@CurrentUser() user: CurrentUserType): CurrentUserType {
    return user;
  }
}
