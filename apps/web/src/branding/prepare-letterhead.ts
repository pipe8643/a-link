import { LETTERHEAD_LIMITS } from "@a-link/shared";
import { ImageSourceError, loadImageFile, renderCrop, sizeOf } from "@/features/images/image-output";
import { letterheadFitSize } from "./letterhead";

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Prepara el membrete para subirlo: decodifica (respeta EXIF), escala si hace falta y re-codifica en JPEG
 * (o PNG) sin metadatos, dentro de `LETTERHEAD_LIMITS`.
 */
export async function prepareLetterhead(file: File): Promise<Blob> {
  const img = await loadImageFile(file);
  const src = sizeOf(img);
  const out = letterheadFitSize(src.width, src.height, LETTERHEAD_LIMITS.maxSide);
  const canvas = renderCrop(img, { x: 0, y: 0, width: src.width, height: src.height }, out.width, out.height);
  for (const type of ["image/jpeg", "image/png"] as const) {
    const qualities = type === "image/png" ? [0.92] : [0.92, 0.85, 0.75, 0.6];
    for (const quality of qualities) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) break;
      if (blob.size <= LETTERHEAD_LIMITS.maxBytes) return blob;
    }
  }
  throw new ImageSourceError("No se pudo preparar la imagen con un peso admisible. Prueba con otra más ligera.");
}
