import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  type CreatePurchaseRequestInput,
  createPurchaseRequestSchema,
  type CurrentUser as CurrentUserType,
  type ListPurchaseRequestsQuery,
  listPurchaseRequestsQuerySchema,
  type Paginated,
  type PurchaseRequestDto,
  type TransitionPurchaseRequestInput,
  transitionPurchaseRequestSchema,
  type UpdatePurchaseRequestInput,
  updatePurchaseRequestSchema,
} from "@app/shared";
import { RequirePermission } from "../../auth/access.js";
import { CurrentUser } from "../../auth/decorators.js";
import { type AuthedRequest, clientIp } from "../../common/request-context.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { PurchaseRequestAttachmentsService } from "./attachments.service.js";
import { PurchaseRequestsService } from "./purchase-requests.service.js";

const idSchema = z.uuid();

@Controller("purchase-requests")
export class PurchaseRequestsController {
  constructor(
    private readonly service: PurchaseRequestsService,
    private readonly attachments: PurchaseRequestAttachmentsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query(new ZodPipe(listPurchaseRequestsQuerySchema)) query: ListPurchaseRequestsQuery,
  ): Promise<Paginated<PurchaseRequestDto>> {
    return this.service.list(user, query);
  }

  @Post()
  @RequirePermission("pr.create")
  create(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequestInput,
    @Req() req: AuthedRequest,
  ): Promise<PurchaseRequestDto> {
    return this.service.create(user, body, clientIp(req));
  }

  @Get(":id")
  get(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
  ): Promise<PurchaseRequestDto> {
    return this.service.get(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Body(new ZodPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequestInput,
    @Req() req: AuthedRequest,
  ): Promise<PurchaseRequestDto> {
    return this.service.update(user, id, body, clientIp(req));
  }

  @Post(":id/transitions")
  transition(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Body(new ZodPipe(transitionPurchaseRequestSchema)) body: TransitionPurchaseRequestInput,
    @Req() req: AuthedRequest,
  ): Promise<PurchaseRequestDto> {
    return this.service.transition(user, id, body, clientIp(req));
  }

  // ---------- Đính kèm (BR-09) ----------

  @Get(":id/attachments")
  listAttachments(@CurrentUser() user: CurrentUserType, @Param("id", new ZodPipe(idSchema)) id: string) {
    return this.attachments.list(user, id);
  }

  /** multipart/form-data, trường "file". Giới hạn dung lượng: FilesModule (FILE_MAX_MB). */
  @Post(":id/attachments")
  @UseInterceptors(FileInterceptor("file"))
  addAttachment(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.attachments.add(user, id, file, clientIp(req));
  }

  @Get(":id/attachments/:fileId/download")
  async downloadAttachment(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Param("fileId", new ZodPipe(idSchema)) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.attachments.download(user, id, fileId, res);
  }

  @Delete(":id/attachments/:fileId")
  @HttpCode(204)
  removeAttachment(
    @CurrentUser() user: CurrentUserType,
    @Param("id", new ZodPipe(idSchema)) id: string,
    @Param("fileId", new ZodPipe(idSchema)) fileId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.attachments.remove(user, id, fileId, clientIp(req));
  }
}
