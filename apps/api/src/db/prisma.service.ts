import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { createPrismaClient, type PrismaClient } from "./prisma-client.js";

/**
 * Único punto de acceso a la base de datos. Los servicios de dominio NO deben consultar recursos por
 * ID sin filtrar por propietario (ver docs/02-arquitectura.md §6).
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
