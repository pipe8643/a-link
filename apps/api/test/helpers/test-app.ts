import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { type AppConfig, loadConfig } from "../../src/config/app-config.js";
import { PrismaService } from "../../src/db/prisma.service.js";
import { MailService } from "../../src/mail/mail.service.js";

export const TEST_ORIGIN = "http://localhost:5173";
export const GOOD_PASSWORD = "Contrasena-Segura-2026!";

/** Buzón en memoria: sustituye al envío de correo real y permite recuperar el enlace de restablecimiento. */
export class InMemoryMail extends MailService {
  sent: Array<{ to: string; resetUrl: string }> = [];
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    this.sent.push({ to, resetUrl });
  }
  lastTokenFor(email: string): string {
    const m = [...this.sent].reverse().find((s) => s.to === email);
    if (!m) throw new Error("No hay correo de restablecimiento para ese destinatario");
    const url = new URL(m.resetUrl);
    return decodeURIComponent(url.hash.replace(/^#/, "")) || url.searchParams.get("token")!;
  }
}

export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL no está definida");
  return {
    NODE_ENV: "test",
    APP_ORIGINS: TEST_ORIGIN,
    DATABASE_URL: url,
    SESSION_SECRET: "secreto-solo-para-pruebas-" + "x".repeat(32),
    // Límites altos por defecto para que las pruebas funcionales no choquen con ellos.
    RATE_LIMIT_PER_MINUTE: "100000",
    AUTH_RATE_LIMIT_PER_MINUTE: "100000",
    LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL: "1000",
    LOGIN_MAX_ATTEMPTS_PER_EMAIL: "10000",
    MAIL_DRIVER: "disabled",
    ...overrides,
  };
}

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  prisma: PrismaService["client"];
  mail: InMemoryMail;
  /** Directorio temporal del almacenamiento privado de esta instancia (se borra en `close`). */
  storageDir: string;
  /** Cliente con cookies persistentes (como un navegador) y cabecera Origin válida por defecto. */
  agent(): ReturnType<typeof request.agent>;
  /** Petición suelta, sin cookies. */
  raw: () => ReturnType<typeof request>;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}, options: { accessLog?: boolean } = {}): Promise<TestApp> {
  const storageDir = mkdtempSync(join(tmpdir(), "alink-storage-"));
  const config = loadConfig(testEnv({ STORAGE_LOCAL_DIR: storageDir, ...env }));
  const mail = new InMemoryMail();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, config, options);
  await app.init();
  const prisma = app.get(PrismaService).client;
  return {
    app,
    config,
    prisma,
    mail,
    storageDir,
    agent: () => request.agent(app.getHttpServer()).set("Origin", TEST_ORIGIN),
    raw: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export function uniqueEmail(prefix = "usuario"): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@example.test`;
}

export function cookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers["set-cookie"] as string[] | undefined;
  return raw?.find((c) => c.startsWith("alink_sid=") || c.startsWith("__Host-alink_sid="));
}

export function cookieValue(setCookie: string | undefined): string | undefined {
  return setCookie?.split(";")[0]?.split("=")[1];
}

export async function register(t: TestApp, email = uniqueEmail(), password = GOOD_PASSWORD) {
  const agent = t.agent();
  const res = await agent.post("/api/v1/auth/register").send({ email, password, displayName: "Demo" });
  return { agent, email, password, res, userId: res.body?.user?.id as string };
}
