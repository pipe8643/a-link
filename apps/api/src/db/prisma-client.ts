import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Opciones de conexión derivadas de DATABASE_URL (mysql://usuario:clave@host:puerto/base[?ssl=true]).
 * Se exporta para poder probar la política de seguridad sin abrir conexiones.
 *
 * Autenticación `caching_sha2_password` (predeterminada en MySQL 8.4): el conector necesita TLS o la
 * clave pública del servidor. Política:
 *  - Host local (desarrollo): se permite `allowPublicKeyRetrieval` (no hay red de por medio).
 *  - Host remoto: NO se permite; hay que usar TLS con `?ssl=true`. Con `?ssl=insecure` se cifra pero
 *    no se valida el certificado (solo para entornos de prueba con certificados autofirmados).
 */
export function parseDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:") {
    throw new Error("DATABASE_URL debe usar el esquema mysql://");
  }
  const host = url.hostname;
  const ssl = url.searchParams.get("ssl");
  const isLoopback = LOOPBACK_HOSTS.has(host);

  return {
    host,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 10,
    connectTimeout: 10_000,
    allowPublicKeyRetrieval: isLoopback && !ssl,
    ...(ssl === "true" ? { ssl: true } : {}),
    ...(ssl === "insecure" ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * Crea un cliente Prisma sobre el adaptador `mariadb` (Prisma 7 exige driver adapter; es el adaptador
 * oficial para MySQL y MariaDB). Los parámetros se pasan explícitamente para no registrar la URL.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaMariaDb(parseDatabaseUrl(databaseUrl));
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
