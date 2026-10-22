import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * E2E contra el sistema REAL: API (NestJS) + MySQL de PRUEBAS + frontend (Vite).
 *
 * - Usa TEST_DATABASE_URL del .env raíz (nunca la base de desarrollo). Cada prueba crea usuarios con
 *   correos únicos, así que no hace falta vaciar la base; aun así, NO ejecutar a la vez que los tests de
 *   la API (esos sí vacían las tablas).
 * - Puertos propios (API 3200, web 5273) para no chocar con los servidores de desarrollo.
 * - La API arranca desde apps/api/dist: ejecuta antes `npm run build -w @a-link/api`.
 * - Secreto de sesión aleatorio por ejecución; correo en modo "fichero" (carpeta ignorada por git).
 */
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  /* sin .env: se exigirá TEST_DATABASE_URL por entorno */
}

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("E2E: define TEST_DATABASE_URL (base de datos de PRUEBAS) en .env o en el entorno.");

const API_PORT = "3200";
const WEB_PORT = "5273";
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const MAIL_DIR = path.resolve(import.meta.dirname, "../api/storage/e2e-mail");
const STORAGE_DIR = path.resolve(import.meta.dirname, "../api/storage/e2e-files");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: WEB_ORIGIN,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "edge",
      // Usa el Edge/Chrome instalado (sin descargar navegadores). En CI: PW_CHANNEL=chromium tras `playwright install`.
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL ?? "msedge", viewport: { width: 1440, height: 900 } },
    },
    // Criterio 15 (multinavegador). Se ejecutan a propósito con `--project firefox|webkit` (npm run e2e:cross):
    // los navegadores se instalan con `npx playwright install firefox webkit`.
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    // El WebKit de Playwright en Windows (no es Safari) cierra o deja en blanco la página de forma intermitente con el lienzo de ZoomCharts: dos reintentos; un reintento que salva la prueba se informa como «flaky».
    { name: "webkit", retries: 2, use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: path.resolve(import.meta.dirname, "../api"),
      url: `${API_ORIGIN}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        API_PORT,
        APP_ORIGINS: WEB_ORIGIN,
        DATABASE_URL: testDb,
        SESSION_SECRET: randomBytes(48).toString("hex"),
        // Límites holgados: las pruebas registran muchos usuarios desde la misma IP. Los límites reales se prueban en la API.
        RATE_LIMIT_PER_MINUTE: "100000",
        AUTH_RATE_LIMIT_PER_MINUTE: "100000",
        LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL: "1000",
        LOGIN_MAX_ATTEMPTS_PER_EMAIL: "10000",
        // Parámetros mínimos de Argon2id solo para acelerar las pruebas.
        ARGON2_MEMORY_KIB: "8192",
        ARGON2_TIME_COST: "1",
        MAIL_DRIVER: "file",
        MAIL_DIR,
        // Exportaciones guardadas: disco local en una carpeta ignorada por git (el contenido se descarta al borrar).
        STORAGE_DRIVER: "local",
        STORAGE_LOCAL_DIR: STORAGE_DIR,
      },
    },
    {
      command: "npx vite",
      cwd: import.meta.dirname,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WEB_PORT, WEB_API_TARGET: API_ORIGIN },
    },
  ],
});
