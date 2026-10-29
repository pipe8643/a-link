/**
 * Márgenes del visor HTML (PowerPoint / Web Viewer) cuando hay imagen de fondo.
 * La imagen la sube cada cuenta; no hay un JPEG embebido en el frontend.
 */
export const LETTERHEAD_MIME = "image/jpeg" as const;

/** Zona interior, en fracción del ancho/alto, para no tapar bordes ni pie del membrete. */
export const LETTERHEAD_INSET = {
  left: 0.048,
  right: 0.03,
  top: 0.05,
  bottom: 0.092,
} as const;

/** Reduce el lado largo para que quepa en el tope del servidor, sin agrandar. */
export function letterheadFitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(1, width), maxSide / Math.max(1, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
