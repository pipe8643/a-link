import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

/**
 * Carga el .env de la raíz del monorepo SOLO fuera de producción. En producción las variables
 * llegan del entorno del contenedor/orquestador (los secretos nunca se leen de ficheros del repo).
 */
export function loadDotenvIfDevelopment(): void {
  if (process.env.NODE_ENV === "production") return;
  loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
}
