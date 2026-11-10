import type { GraphSnapshot } from "@a-link/shared";
import type { ImageUrlResolver } from "../editor/zoom-data";

const FETCH_TIMEOUT_MS = 10_000;
const abortError = () => new DOMException("Exportación cancelada.", "AbortError");

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Imágenes de entidades como `data:` (el HTML portable no puede pedirlas al servidor). Un fallo puntual se omite.
 */
export async function loadNodeDataUrls(doc: GraphSnapshot, imageUrl: ImageUrlResolver | undefined, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!imageUrl) return out;
  const pending = new Map<string, Promise<string | null>>();
  for (const node of doc.nodes) {
    if (signal?.aborted) throw abortError();
    const url = node.imageId ? imageUrl(node) : undefined;
    if (!url) continue;
    if (!pending.has(url)) {
      pending.set(
        url,
        (async () => {
          try {
            const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
            const res = await fetch(url, { credentials: "same-origin", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            if (!res.ok) return null;
            return blobToDataUrl(await res.blob());
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError" && signal?.aborted) throw err;
            return null;
          }
        })(),
      );
    }
    const data = await pending.get(url)!;
    if (data) out.set(node.id, data);
  }
  return out;
}
