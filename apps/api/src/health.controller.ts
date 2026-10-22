import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./auth/auth.guard.js";
import { PrismaService } from "./db/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Sin detalles internos: solo si el servicio y la base de datos responden. */
  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ code: "DB_UNAVAILABLE", message: "Servicio no disponible." });
    }
    return { status: "ok" };
  }
}
