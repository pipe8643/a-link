import { Module } from "@nestjs/common";
import { GraphImagesController } from "./images.controller.js";
import { ImagesService } from "./images.service.js";

@Module({
  controllers: [GraphImagesController],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
