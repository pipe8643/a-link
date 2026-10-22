/**
 * Configuración que se inyecta en TIEMPO DE EJECUCIÓN mediante `/config.js` (no se compila en el bundle):
 *  - en desarrollo la sirve Vite a partir del `.env` raíz (ver vite.config.ts);
 *  - en producción la genera Nginx/el entrypoint desde variables de entorno (Fase 8).
 *
 * La licencia de ZoomCharts es forzosamente visible para el navegador (es una licencia del lado cliente);
 * lo que se garantiza es que no esté en el repositorio ni en las imágenes públicas.
 */
export interface RuntimeConfig {
  zoomChartsLicense: string;
  zoomChartsLicenseKey: string;
}

declare global {
  interface Window {
    __ALINK_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const raw = typeof window === "undefined" ? undefined : window.__ALINK_CONFIG__;
  return {
    zoomChartsLicense: typeof raw?.zoomChartsLicense === "string" ? raw.zoomChartsLicense : "",
    zoomChartsLicenseKey: typeof raw?.zoomChartsLicenseKey === "string" ? raw.zoomChartsLicenseKey : "",
  };
}
