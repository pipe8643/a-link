import type { GraphSnapshot } from "@a-link/shared";
import { ENTITY_CATALOG } from "@a-link/shared";
import { outputSize } from "../images/crop";
import { imageFrameFor } from "../editor/shapes";
import type { ImageUrlResolver } from "../editor/zoom-data";

/** Lado mayor (px) de la imagen de cada entidad en el PowerPoint editable: suficiente para una diapositiva y ligero. */
const PPTX_IMAGE_SIDE = 192;
const FETCH_TIMEOUT_MS = 10_000;
const abortError = () => new DOMException("Exportación cancelada.", "AbortError");

/** Imagen recortada a la forma de la entidad, como PNG con transparencia fuera del contorno. */
export function maskToShape(source: CanvasImageSource & { width: number; height: number }, outline: ReadonlyArray<readonly [number, number]>, aspect: number, side = PPTX_IMAGE_SIDE): HTMLCanvasElement {
  const { width, height } = outputSize(aspect, side);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen de la entidad.");
  ctx.beginPath();
  outline.forEach(([ux, uy], i) => {
    const x = ((ux + 1) * width) / 2;
    const y = ((uy + 1) * height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  const scale = Math.max(width / source.width, height / source.height); // «cover»
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  return canvas;
}

async function fetchBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, { credentials: "same-origin", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) throw new Error("No se pudo leer una imagen.");
  return createImageBitmap(await res.blob());
}

const toDataUri = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png").slice("data:".length); // «image/png;base64,…» (formato de pptxgenjs)

/**
 * Para el PowerPoint editable: la imagen de cada entidad ya recortada a SU forma (PNG con transparencia), indexada por
 * identificador de entidad. Una imagen que no se pueda leer se omite (la entidad conserva su forma de color). Las
 * descargas son del mismo origen, con la sesión del usuario; nada sale del navegador.
 */
export async function loadMaskedNodeImages(doc: GraphSnapshot, imageUrl: ImageUrlResolver | undefined, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!imageUrl) return out;
  const bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  const masked = new Map<string, string>();
  for (const node of doc.nodes) {
    if (signal?.aborted) throw abortError();
    const url = node.imageId ? imageUrl(node) : undefined;
    if (!url) continue;
    const shape = ENTITY_CATALOG[node.type].shape;
    const cacheKey = `${url}|${shape}`;
    let uri = masked.get(cacheKey);
    if (!uri) {
      if (!bitmaps.has(url)) bitmaps.set(url, fetchBitmap(url, signal).catch((e: unknown) => (e instanceof DOMException && e.name === "AbortError" && signal?.aborted ? Promise.reject(e) : null)));
      const bitmap = await bitmaps.get(url)!;
      if (!bitmap) continue;
      const frame = imageFrameFor(node.type);
      uri = toDataUri(maskToShape(bitmap, frame.outline, frame.aspect));
      masked.set(cacheKey, uri);
    }
    out.set(node.id, uri);
  }
  for (const p of bitmaps.values()) void p.then((b) => b?.close());
  return out;
}
