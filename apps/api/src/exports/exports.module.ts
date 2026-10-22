import { Module } from "@nestjs/common";
import { ExportsService } from "./exports.service.js";
import { FilesController, GraphExportsController } from "./exports.controller.js";

@Module({
  controllers: [GraphExportsController, FilesController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
