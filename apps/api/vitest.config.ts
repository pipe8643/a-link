import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Variables de la raíz del monorepo (TEST_DATABASE_URL, etc.). No pisa las ya definidas en el entorno.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  // SWC emite los metadatos de decoradores que necesita la inyección de dependencias de NestJS.
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Las pruebas de integración comparten una única base de datos: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
