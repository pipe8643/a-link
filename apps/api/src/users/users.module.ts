import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { LetterheadService } from "./letterhead.service.js";
import { UsersController } from "./users.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [LetterheadService],
})
export class UsersModule {}
