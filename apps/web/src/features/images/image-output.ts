import { IMAGE_LIMITS } from "@a-link/shared";
import { type Box, type Size, outputSize } from "./crop";

/** Formatos de origen que se aceptan al elegir un archivo (el resultado siempre se re-codifica en el navegador). */
export const SOURCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const SOURCE_MAX_BYTES = 15 * 1024 * 1024;
export const SOURCE_MAX_PIXELS = 50_000_000;

export class ImageSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageSourceError";
  }
}

/** Comprueba tipo y peso ANTES de decodificar (la decodificación de una imagen enorme bloquea la página). */
export function validateSourceFile(file: Pick<File, "type" | "size">): void {
  if (!(SOURCE_MIME_TYPES as readonly string[]).includes(file.type)) throw new ImageSourceError("Formato no admitido. Usa una imagen JPEG, PNG o WebP.");
  if (file.size === 0) throw new ImageSourceError("El archivo está vacío.");
  if (file.size > SOURCE_MAX_BYTES) throw new ImageSourceError("La imagen es demasiado grande (máximo 15 MB).");
}

/**
 * Decodifica el archivo en un `<img>` (respetando la orientación EXIF, igual que el detector y el recorte, que usan el
 * mismo elemento). La URL temporal `blob:` se libera en cuanto la imagen está decodificada.
 */
export async function loadImageFile(file: File): Promise<HTMLImageElement> {
  validateSourceFile(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new ImageSourceError("No se pudo leer la imagen: el archivo está dañado o no es una imagen válida.");
    }
    if (img.naturalWidth < 1 || img.naturalHeight < 1) throw new ImageSourceError("La imagen no tiene dimensiones válidas.");
    if (img.naturalWidth * img.naturalHeight > SOURCE_MAX_PIXELS) throw new ImageSourceError("La imagen tiene demasiados píxeles (máximo 50 megapíxeles).");
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const sizeOf = (img: HTMLImageElement): Size => ({ width: img.naturalWidth, height: img.naturalHeight });

/** Dibuja el recorte (rectángulo de origen) en un lienzo de `width × height`. Fondo blanco: evita fondos negros al pasar a JPEG. */
export function renderCrop(img: CanvasImageSource, rect: Box, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageSourceError("Tu navegador no permite preparar la imagen.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Codifica el lienzo como WebP o, si el navegador no lo soporta (Safari), JPEG. Nunca PNG: el lienzo no lleva EXIF ni
 * texto, pero así el resultado es siempre pequeño y de un formato que el servidor acepta. Baja la calidad hasta cumplir
 * el límite de peso del servidor.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const quality of [0.9, 0.8, 0.7, 0.55]) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) break; // el navegador no soporta este formato: probar el siguiente
      if (blob.size <= IMAGE_LIMITS.maxBytes) return blob;
    }
  }
  throw new ImageSourceError("No se pudo preparar la imagen con un peso admisible. Prueba con otra.");
}

/** Recorta y codifica la imagen final de una entidad. */
export async function buildEntityImage(img: HTMLImageElement, rect: Box, aspect: number): Promise<Blob> {
  const { width, height } = outputSize(aspect, IMAGE_LIMITS.outputSide);
  return encodeCanvas(renderCrop(img, rect, width, height));
}
