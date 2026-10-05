import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  type CreateDepartmentInput,
  createDepartmentSchema,
  type CurrentUser as CurrentUserType,
  type ListDepartmentsQuery,
  listDepartmentsQuerySchema,
  type UpdateDepartmentInput,
  updateDepartmentSchema,
} from "@app/shared";
import { RequirePermission } from "../../auth/access.js";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { DepartmentsService } from "./departments.service.js";

@Controller("admin/departments")
@RequirePermission("departments.manage")
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  list(@Query(new ZodPipe(listDepartmentsQuerySchema)) q: ListDepartmentsQuery) {
    return this.service.list(q);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(createDepartmentSchema)) body: CreateDepartmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.service.create(user, body, clientIp(req));
  }

  @Patch(":id")
  update(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.service.update(user, id, body, clientIp(req));
  }
}
