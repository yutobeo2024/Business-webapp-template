import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  createUserSchema,
  type CurrentUser as CurrentUserType,
  type ListUsersQuery,
  listUsersQuerySchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type SetUserActiveInput,
  setUserActiveSchema,
  updateUserSchema,
} from "@app/shared";
import { RequirePermission } from "../../auth/access.js";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { UsersService } from "./users.service.js";

const idPipe = new ZodPipe(z.uuid());

@Controller("admin/users")
@RequirePermission("users.manage")
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(@Query(new ZodPipe(listUsersQuerySchema)) q: ListUsersQuery) {
    return this.service.list(q);
  }

  /** Đặt trước ":id" để "options" không bị hiểu là một id. */
  @Get("options")
  options(@CurrentUser() user: CurrentUserType) {
    return this.service.options(user);
  }

  @Get(":id")
  get(@Param("id", idPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.service.create(user, body, clientIp(req));
  }

  @Patch(":id")
  update(
    @CurrentUser() user: CurrentUserType,
    @Param("id", idPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.output<typeof updateUserSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.service.update(user, id, body, clientIp(req));
  }

  @Post(":id/active")
  @HttpCode(200)
  setActive(
    @CurrentUser() user: CurrentUserType,
    @Param("id", idPipe) id: string,
    @Body(new ZodPipe(setUserActiveSchema)) body: SetUserActiveInput,
    @Req() req: AuthedRequest,
  ) {
    return this.service.setActive(user, id, body, clientIp(req));
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  resetPassword(
    @CurrentUser() user: CurrentUserType,
    @Param("id", idPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: AuthedRequest,
  ) {
    return this.service.resetPassword(user, id, body, clientIp(req));
  }

  @Post(":id/unlock")
  @HttpCode(200)
  unlock(@CurrentUser() user: CurrentUserType, @Param("id", idPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.unlock(user, id, clientIp(req));
  }
}
