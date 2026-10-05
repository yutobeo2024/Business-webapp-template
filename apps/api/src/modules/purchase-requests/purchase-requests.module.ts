import { Module } from "@nestjs/common";
import { PurchaseRequestAttachmentsService } from "./attachments.service.js";
import { PurchaseRequestsController } from "./purchase-requests.controller.js";
import { PurchaseRequestsService } from "./purchase-requests.service.js";

@Module({
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService, PurchaseRequestAttachmentsService],
})
export class PurchaseRequestsModule {}
