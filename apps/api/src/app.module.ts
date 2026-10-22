import { type DynamicModule, type ExecutionContext, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { APP_CONFIG, type AppConfig } from "./config/app-config.js";
import { CoreModule } from "./core.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { ExportsModule } from "./exports/exports.module.js";
import { FoldersModule } from "./folders/folders.module.js";
import { GraphsModule } from "./graphs/graphs.module.js";
import { HealthController } from "./health.controller.js";
import { ImagesModule } from "./images/images.module.js";
import { SharesModule } from "./shares/shares.module.js";
import { UsersModule } from "./users/users.module.js";

/** Rutas sensibles a fuerza bruta/abuso: reciben un límite de peticiones MÁS estricto. */
const AUTH_ABUSE_PATHS = /^\/api\/v1\/(auth\/(login|register|forgot-password|reset-password)|users\/me\/password)$/;

function isAuthAbuseRoute(context: ExecutionContext): boolean {
  const req = context.switchToHttp().getRequest<Request>();
  return req.method === "POST" && AUTH_ABUSE_PATHS.test(req.path);
}

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.register(config),
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (cfg: AppConfig) => ({
            throttlers: [
              { name: "default", ttl: 60_000, limit: cfg.rateLimitPerMinute },
              {
                name: "auth",
                ttl: 60_000,
                limit: cfg.authRateLimitPerMinute,
                skipIf: (ctx: ExecutionContext) => !isAuthAbuseRoute(ctx),
              },
            ],
          }),
        }),
        AuthModule,
        UsersModule,
        FoldersModule,
        GraphsModule,
        ExportsModule,
        ImagesModule,
        SharesModule,
        DashboardModule,
      ],
      controllers: [HealthController],
      providers: [
        // El orden importa: primero se limita el ritmo, después se exige sesión (denegar por defecto).
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
