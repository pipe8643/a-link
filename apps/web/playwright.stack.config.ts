import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pruebas contra el stack REAL en contenedores (Nginx + TLS + API en producción + MySQL), no contra el servidor de
 * desarrollo. Requisitos:
 *
 *   docker compose --env-file .env.docker --env-file .env.docker.test up -d --build
 *   npm run e2e:stack -w @a-link/web
 *
 * Por defecto apunta a https://localhost:8443 (certificado autofirmado: se aceptan los errores de certificado SOLO
 * aquí). Las pruebas no vacían nada: crean usuarios con correos únicos. Se ejecutan de una en una (un único
 * limitador de frecuencia por IP en Nginx).
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const STACK_URL = process.env.STACK_URL ?? "https://localhost:8443";

/** Lee un fichero de entorno SIN modificarlo ni volcarlo (el stack usa .env.docker; la licencia viene de ahí). */
function readEnvFile(name: string): Record<string, string> {
  const file = path.join(ROOT, name);
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}
const stackEnv = readEnvFile(".env.docker");
// Las pruebas con lienzo necesitan saber si el stack tiene licencia; la contraseña de la demo solo se pasa al proceso.
process.env.STACK_HAS_LICENSE ??= stackEnv.ZOOMCHARTS_LICENSE && stackEnv.ZOOMCHARTS_LICENSE_KEY ? "1" : "";
process.env.STACK_DEMO_PASSWORD ??= stackEnv.DEMO_USER_PASSWORD ?? "";
process.env.STACK_URL = STACK_URL;

export default defineConfig({
  testDir: "./e2e-stack",
  outputDir: "./test-results-stack",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-stack" }]],
  use: {
    baseURL: STACK_URL,
    ignoreHTTPSErrors: true,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "edge", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL ?? "msedge" } }],
});
