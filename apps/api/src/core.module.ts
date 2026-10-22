import { type DynamicModule, Global, Module } from "@nestjs/common";
import { AuditService } from "./audit/audit.service.js";
import { OwnershipService } from "./common/ownership.service.js";
import { APP_CONFIG, type AppConfig } from "./config/app-config.js";
import { PrismaService } from "./db/prisma.service.js";
import { DisabledMailService, FileMailService, MailService } from "./mail/mail.service.js";
import { createStorage } from "./storage/create-storage.js";
import { StorageService } from "./storage/storage.service.js";

/** Proveedores transversales: configuración, base de datos, auditoría y correo. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        PrismaService,
        AuditService,
        OwnershipService,
        { provide: StorageService, useFactory: (cfg: AppConfig): StorageService => createStorage(cfg.storage), inject: [APP_CONFIG] },
        {
          provide: MailService,
          useFactory: (cfg: AppConfig): MailService =>
            cfg.mailDriver === "file" ? new FileMailService(cfg) : new DisabledMailService(),
          inject: [APP_CONFIG],
        },
      ],
      exports: [APP_CONFIG, PrismaService, AuditService, OwnershipService, MailService, StorageService],
    };
  }
}
