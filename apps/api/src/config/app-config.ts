import { resolve } from "node:path";
import { z } from "zod";

export const APP_CONFIG = Symbol("APP_CONFIG");

const MIN_SECRET_LENGTH = 32;

const origin = z.string().transform((value, ctx) => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocolo");
    return url.origin;
  } catch {
    ctx.addIssue({ code: "custom", message: "no es un origen http(s) válido" });
    return z.NEVER;
  }
});

const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: int(3000, 1, 65535),
  APP_ORIGINS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(origin).min(1)),
  DATABASE_URL: z.string().startsWith("mysql://", { message: "debe empezar por mysql://" }),
  SESSION_SECRET: z.string().min(MIN_SECRET_LENGTH, { message: `mínimo ${MIN_SECRET_LENGTH} caracteres` }),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).default("alink_sid"),
  SESSION_TTL_HOURS: int(12, 1, 24 * 30),
  SESSION_ABSOLUTE_TTL_DAYS: int(14, 1, 90),
  PASSWORD_RESET_TTL_MINUTES: int(30, 5, 24 * 60),
  MAX_REQUEST_BODY_MB: int(2, 1, 100),
  /** Límite SOLO para el guardado del contenido de un grafo (hasta 5 000 entidades y 20 000 relaciones). */
  MAX_GRAPH_CONTENT_MB: int(16, 1, 100),
  /** Nº de proxys de confianza delante de la API (Nginx = 1). 0 = ninguno. */
  TRUST_PROXY_HOPS: int(0, 0, 10),
  RATE_LIMIT_PER_MINUTE: int(120, 1, 100_000),
  AUTH_RATE_LIMIT_PER_MINUTE: int(10, 1, 100_000),
  LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL: int(5, 1, 1000),
  LOGIN_MAX_ATTEMPTS_PER_EMAIL: int(30, 1, 10_000),
  ARGON2_MEMORY_KIB: int(19_456, 8_192, 1_048_576),
  ARGON2_TIME_COST: int(2, 1, 10),
  ARGON2_PARALLELISM: int(1, 1, 16),
  REGISTRATION_ENABLED: z.enum(["true", "false"]).default("true"),
  MAIL_DRIVER: z.enum(["file", "disabled"]).optional(),
  MAIL_DIR: z.string().min(1).default("./storage/dev-mail"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().min(1).default("./storage"),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).max(63).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Tamaño máximo de UN fichero exportado guardado en el almacenamiento privado. */
  MAX_EXPORT_FILE_MB: int(50, 1, 500),
  /** Espacio total por usuario para exportaciones guardadas. */
  EXPORT_QUOTA_MB_PER_USER: int(512, 1, 100_000),
});

export type StorageConfig =
  | { driver: "local"; localDir: string }
  | { driver: "s3"; endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  appOrigins: string[];
  databaseUrl: string;
  sessionSecret: string;
  sessionCookieName: string;
  sessionTtlMs: number;
  sessionAbsoluteTtlMs: number;
  passwordResetTtlMs: number;
  maxRequestBodyBytes: number;
  maxGraphContentBytes: number;
  trustProxyHops: number;
  rateLimitPerMinute: number;
  authRateLimitPerMinute: number;
  loginMaxAttemptsPerIpEmail: number;
  loginMaxAttemptsPerEmail: number;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  registrationEnabled: boolean;
  mailDriver: "file" | "disabled";
  mailDir: string;
  storage: StorageConfig;
  maxExportFileBytes: number;
  exportQuotaBytes: number;
  swaggerEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuración no válida:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Valida y normaliza las variables de entorno. Los mensajes de error mencionan SOLO el nombre de la
 * variable y la regla incumplida, nunca su valor (podría ser un secreto).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // Cadenas vacías (p. ej. "KEY=" en .env) se tratan como no definidas.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`));
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";

  const problems: string[] = [];
  if (isProduction) {
    if (/CAMBIAR|CHANGE_?ME|example/i.test(e.SESSION_SECRET)) {
      problems.push("SESSION_SECRET: parece un valor de ejemplo; genera uno aleatorio");
    }
    if (e.APP_ORIGINS.some((o) => o.startsWith("http://"))) {
      problems.push("APP_ORIGINS: en producción todos los orígenes deben ser https");
    }
    if (e.MAIL_DRIVER === "file") {
      problems.push("MAIL_DRIVER: 'file' guarda enlaces de recuperación en disco; no se permite en producción");
    }
  }
  if (e.STORAGE_DRIVER === "s3") {
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!e[name]) problems.push(`${name}: obligatoria con STORAGE_DRIVER=s3`);
    }
  }
  if (problems.length) throw new ConfigError(problems);

  const storage: StorageConfig =
    e.STORAGE_DRIVER === "s3"
      ? {
          driver: "s3",
          ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT } : {}),
          region: e.S3_REGION,
          bucket: e.S3_BUCKET!,
          accessKeyId: e.S3_ACCESS_KEY_ID!,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        }
      : { driver: "local", localDir: resolve(e.STORAGE_LOCAL_DIR) };

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.API_PORT,
    appOrigins: e.APP_ORIGINS,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sessionCookieName: e.SESSION_COOKIE_NAME,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3_600_000,
    sessionAbsoluteTtlMs: e.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000,
    passwordResetTtlMs: e.PASSWORD_RESET_TTL_MINUTES * 60_000,
    maxRequestBodyBytes: e.MAX_REQUEST_BODY_MB * 1024 * 1024,
    maxGraphContentBytes: e.MAX_GRAPH_CONTENT_MB * 1024 * 1024,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    authRateLimitPerMinute: e.AUTH_RATE_LIMIT_PER_MINUTE,
    loginMaxAttemptsPerIpEmail: e.LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL,
    loginMaxAttemptsPerEmail: e.LOGIN_MAX_ATTEMPTS_PER_EMAIL,
    argon2: { memoryCost: e.ARGON2_MEMORY_KIB, timeCost: e.ARGON2_TIME_COST, parallelism: e.ARGON2_PARALLELISM },
    registrationEnabled: e.REGISTRATION_ENABLED === "true",
    mailDriver: e.MAIL_DRIVER ?? (isProduction ? "disabled" : "file"),
    mailDir: e.MAIL_DIR,
    storage,
    maxExportFileBytes: e.MAX_EXPORT_FILE_MB * 1024 * 1024,
    exportQuotaBytes: e.EXPORT_QUOTA_MB_PER_USER * 1024 * 1024,
    swaggerEnabled: !isProduction,
  };
}

/** Nombre real de la cookie: en producción lleva prefijo __Host- (exige Secure, Path=/ y sin Domain). */
export function cookieNameFor(config: AppConfig): string {
  return config.isProduction ? `__Host-${config.sessionCookieName}` : config.sessionCookieName;
}
