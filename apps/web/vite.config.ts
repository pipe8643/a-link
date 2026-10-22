import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Sirve `/config.js` con la configuración de TIEMPO DE EJECUCIÓN (licencia de ZoomCharts) leída del
 * entorno/.env. En el build se emite un `config.js` VACÍO: la clave nunca se compila en el bundle;
 * en producción lo sustituye el que genera Nginx/el entrypoint desde variables de entorno.
 */
function runtimeConfig(values: { zoomChartsLicense: string; zoomChartsLicenseKey: string }): Plugin {
  const script = (v: typeof values) => `window.__ALINK_CONFIG__=${JSON.stringify(v)};\n`;
  const serve = (_req: unknown, res: { setHeader(k: string, v: string): void; end(body: string): void }) => {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(script(values));
  };
  return {
    name: "alink-runtime-config",
    configureServer: (server) => void server.middlewares.use("/config.js", serve),
    configurePreviewServer: (server) => void server.middlewares.use("/config.js", serve),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "config.js", source: script({ zoomChartsLicense: "", zoomChartsLicenseKey: "" }) });
    },
  };
}

/**
 * Motor WebAssembly de MediaPipe (detección de rostros) servido desde NUESTRO origen en `/mediapipe/`: la imagen de una
 * persona nunca sale hacia un tercero. Los binarios (13 MB) se toman de `node_modules` al arrancar/compilar en lugar de
 * versionarlos; el modelo `blaze_face_short_range.tflite` (230 KB, Apache-2.0) sí está en `public/mediapipe/`.
 * Solo se publica la variante con SIMD (todos los navegadores actuales); sin ella la app recorta de forma manual.
 */
const MEDIAPIPE_FILES = { "vision_wasm_internal.js": "text/javascript; charset=utf-8", "vision_wasm_internal.wasm": "application/wasm" } as const;
function mediapipeAssets(): Plugin {
  const dir = () => path.join(path.dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision")), "wasm");
  const serve = (req: { url?: string }, res: { setHeader(k: string, v: string): void; statusCode: number; end(): void }, next: () => void) => {
    const name = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\//, "");
    const type = (MEDIAPIPE_FILES as Record<string, string | undefined>)[name];
    if (!type) return next();
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    createReadStream(path.join(dir(), name)).pipe(res as unknown as NodeJS.WritableStream);
  };
  return {
    name: "alink-mediapipe-assets",
    configureServer: (server) => void server.middlewares.use("/mediapipe", serve),
    configurePreviewServer: (server) => void server.middlewares.use("/mediapipe", serve),
    generateBundle() {
      for (const name of Object.keys(MEDIAPIPE_FILES)) this.emitFile({ type: "asset", fileName: `mediapipe/${name}`, source: readFileSync(path.join(dir(), name)) });
    },
  };
}
/**
 * El navegador solo habla con SU PROPIO origen: `/api` se reenvía a la API. Así la cookie de sesión
 * es de primera parte (SameSite=Lax) y la comprobación de Origen de la API ve el origen del front,
 * igual que en producción detrás de Nginx.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const apiTarget = process.env.WEB_API_TARGET ?? `http://127.0.0.1:${env.API_PORT ?? "3000"}`;
  const port = Number(process.env.WEB_PORT ?? 5173);
  return {
    plugins: [
      react(),
      tailwindcss(),
      mediapipeAssets(),
      runtimeConfig({
        zoomChartsLicense: process.env.ZOOMCHARTS_LICENSE ?? env.ZOOMCHARTS_LICENSE ?? "",
        zoomChartsLicenseKey: process.env.ZOOMCHARTS_LICENSE_KEY ?? env.ZOOMCHARTS_LICENSE_KEY ?? "",
      }),
    ],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: { "/api": { target: apiTarget, changeOrigin: false } },
    },
    preview: { host: "127.0.0.1", port, strictPort: true, proxy: { "/api": { target: apiTarget } } },
    build: { sourcemap: false, target: "es2022" },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
