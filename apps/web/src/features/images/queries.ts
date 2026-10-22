import type { IMAGE_LIMITS } from "@a-link/shared";
import { API_BASE, api } from "@/lib/api";

export interface GraphImage {
  id: string;
  mime: (typeof IMAGE_LIMITS.mimeTypes)[number];
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

/** URL (mismo origen, con la cookie de sesión) de la imagen de una entidad. El servidor vuelve a autorizar cada lectura. */
export const graphImageUrl = (graphId: string, imageId: string): string => `${API_BASE}/graphs/${encodeURIComponent(graphId)}/images/${encodeURIComponent(imageId)}`;

/** Sube la imagen YA recortada. El servidor valida el contenido real (firma, dimensiones, sin metadatos). */
export async function uploadGraphImage(graphId: string, blob: Blob, signal?: AbortSignal): Promise<GraphImage> {
  const { image } = await api<{ image: GraphImage }>(`/graphs/${encodeURIComponent(graphId)}/images`, {
    method: "POST",
    binary: { data: blob, contentType: blob.type },
    ...(signal ? { signal } : {}),
  });
  return image;
}
