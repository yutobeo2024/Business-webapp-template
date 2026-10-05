import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  createRoleSchema,
  type CurrentUser as CurrentUserType,
  type ListRolesQuery,
  listRolesQuerySchema,
  updateRoleSchema,
} from "@app/shared";
import { RequirePermission } from "../../auth/access.js";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { RolesService } from "./roles.service.js";

@Controller("admin")
@RequirePermission("roles.manage")
export class RolesController {
  constructor(private readonly service: RolesService) {}

  /** Danh mục quyền theo nhóm, để vẽ màn chỉnh vai trò. */
  @Get("permissions")
  permissions() {
    return this.service.permissionCatalog();
  }

  @Get("roles")
  list(@Query(new ZodPipe(listRolesQuerySchema)) q: ListRolesQuery) {
    return this.service.list(q);
  }

  @Get("roles/:id")
  get(@Param("id", new ZodPipe(z.uuid())) id: string) {
    return this.service.get(id);
  }

  @Post("roles")
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(createRoleSchema)) body: z.output<typeof createRoleSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.service.create(user, body, clientIp(req));
  }

  @Patch("roles/:id")
  update(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.service.update(user, id, body, clientIp(req));
  }

  @Delete("roles/:id")
  @HttpCode(204)
  remove(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(z.uuid())) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.remove(user, id, clientIp(req));
  }
}
