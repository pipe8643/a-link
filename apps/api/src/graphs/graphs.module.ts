import { Module } from "@nestjs/common";
import { GraphContentService } from "./graph-content.service.js";
import { GraphsController } from "./graphs.controller.js";
import { GraphsService } from "./graphs.service.js";

@Module({
  controllers: [GraphsController],
  providers: [GraphsService, GraphContentService],
  exports: [GraphsService],
})
export class GraphsModule {}
