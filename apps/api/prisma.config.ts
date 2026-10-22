import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// El .env vive en la RAÍZ del monorepo (un único archivo de configuración, nunca versionado).
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

/**
 * Prisma 7 no lee la URL desde schema.prisma. La cadena de conexión viene SIEMPRE del entorno.
 * `prisma validate` y `prisma generate` no necesitan conectarse, por eso hay un valor de relleno.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "mysql://placeholder:placeholder@localhost:3306/placeholder",
  },
});
