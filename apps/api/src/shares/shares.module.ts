import { Module } from "@nestjs/common";
import { GraphSharesController, SharedController } from "./shares.controller.js";
import { SharesService } from "./shares.service.js";

@Module({
  controllers: [GraphSharesController, SharedController],
  providers: [SharesService],
})
export class SharesModule {}
