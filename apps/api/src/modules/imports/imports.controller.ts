import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { type CurrentUser as CurrentUserType, type ImportType, importTypeSchema } from "@app/shared";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { ImportsService } from "./imports.service.js";

/** Quyền theo từng loại nhập (IMPORT_TYPES.permission) do service kiểm. */
@Controller("imports")
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Get("types/:type/template")
  async template(
    @CurrentUser() user: CurrentUserType,
    @Param("type", new ZodPipe(importTypeSchema)) type: ImportType,
    @Res() res: Response,
  ): Promise<void> {
    await this.service.sendTemplate(user, type, res);
  }

  /** multipart/form-data, trường "file" (.xlsx). */
  @Post("types/:type")
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @CurrentUser() user: CurrentUserType,
    @Param("type", new ZodPipe(importTypeSchema)) type: ImportType,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.service.upload(user, type, file, clientIp(req));
  }

  @Get(":id")
  get(@CurrentUser() user: CurrentUserType, @Param("id", new ZodPipe(z.uuid())) id: string) {
    return this.service.get(user, id);
  }

  @Post(":id/commit")
  @HttpCode(200)
  commit(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(z.uuid())) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.service.commit(user, id, clientIp(req));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: CurrentUserType, @Param("id", new ZodPipe(z.uuid())) id: string) {
    return this.service.cancel(user, id);
  }
}
