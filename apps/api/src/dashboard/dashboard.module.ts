import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller.js";

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
