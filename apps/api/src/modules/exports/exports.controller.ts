import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  type CreateExportInput,
  createExportSchema,
  type CurrentUser as CurrentUserType,
  type ExportJobDto,
} from "@app/shared";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { ExportsService } from "./exports.service.js";

const idSchema = z.uuid();

/** Quyền theo từng loại xuất (EXPORT_TYPES.permission) do service kiểm, nên controller không gắn @RequirePermission. */
@Controller("exports")
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  @Post()
  request(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(createExportSchema)) body: CreateExportInput,
    @Req() req: AuthedRequest,
  ): Promise<ExportJobDto> {
    return this.service.request(user, body, clientIp(req));
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType): Promise<ExportJobDto[]> {
    return this.service.listMine(user);
  }

  @Get(":id")
  get(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
  ): Promise<ExportJobDto> {
    return this.service.get(user, id);
  }

  @Get(":id/download")
  async download(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.service.download(user, id, res, clientIp(req));
  }
}
