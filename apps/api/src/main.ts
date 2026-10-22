import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { ConfigError, loadConfig } from "./config/app-config.js";
import { loadDotenvIfDevelopment } from "./config/load-dotenv.js";

async function bootstrap(): Promise<void> {
  loadDotenvIfDevelopment();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Solo nombres de variables y reglas; nunca valores.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
    logger: config.isProduction ? ["log", "warn", "error"] : ["log", "warn", "error", "debug"],
  });
  configureApp(app, config, { accessLog: true });
  app.enableShutdownHooks();

  const host = process.env.API_HOST ?? "127.0.0.1";
  await app.listen(config.port, host);
  new Logger("Arranque").log(`API escuchando en http://${host}:${config.port}/api/v1 (${config.nodeEnv})`);
}

function exitOnFatal(kind: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  new Logger("Proceso").error(`${kind}: ${name}`);
  process.exit(1);
}

process.on("unhandledRejection", (reason) => exitOnFatal("unhandledRejection", reason));
process.on("uncaughtException", (err) => exitOnFatal("uncaughtException", err));

void bootstrap();
