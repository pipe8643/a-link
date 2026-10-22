import { type GraphSnapshot, graphSnapshotSchema } from "@a-link/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api } from "@/lib/api";
import { SHARE_TOKEN_HEADER, type ShareDays, type ShareStatus } from "./share-link";

export interface ShareLink {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  status: ShareStatus;
}

export const shareKeys = { list: (graphId: string) => ["shares", graphId] as const };

export function useShares(graphId: string, enabled: boolean) {
  return useQuery({
    queryKey: shareKeys.list(graphId),
    enabled,
    queryFn: ({ signal }) => api<{ items: ShareLink[] }>(`/graphs/${graphId}/shares`, { signal }).then((r) => r.items),
  });
}

/** Crea un enlace. El token solo viaja en ESTA respuesta: hay que mostrarlo o usarlo ahora, no se puede volver a consultar. */
export async function createShare(graphId: string, days: ShareDays, signal?: AbortSignal): Promise<{ share: ShareLink; token: string }> {
  return api<{ share: ShareLink; token: string }>(`/graphs/${graphId}/shares`, { method: "POST", body: { days }, ...(signal ? { signal } : {}) });
}

export function useCreateShare(graphId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: ShareDays) => createShare(graphId, days),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shareKeys.list(graphId) }),
  });
}

export function useRevokeShare(graphId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api(`/graphs/${graphId}/shares/${shareId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shareKeys.list(graphId) }),
  });
}

// ---------------------------------------------------------------------------------------------
// Vista pública (sin sesión): se autoriza SOLO con el token de la cabecera.
// ---------------------------------------------------------------------------------------------
export class SharedLinkError extends Error {
  constructor(
    /** `invalid`: no existe, caducó o fue revocado (el servidor no distingue); `network`: no se pudo conectar. */
    readonly kind: "invalid" | "network" | "format",
  ) {
    super(kind === "network" ? "No se pudo conectar con el servidor." : kind === "format" ? "El grafo compartido no se pudo leer." : "Este enlace no es válido, ha caducado o fue revocado.");
    this.name = "SharedLinkError";
  }
}

export interface SharedGraph {
  name: string;
  expiresAt: string;
  doc: GraphSnapshot;
}

async function sharedFetch(path: string, token: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    // Sin credenciales: el visor público no usa ni envía la cookie de sesión.
    res = await fetch(`${API_BASE}${path}`, { headers: { [SHARE_TOKEN_HEADER]: token, Accept: "*/*" }, credentials: "omit", cache: "no-store", ...(signal ? { signal } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new SharedLinkError("network");
  }
  if (res.status === 404) throw new SharedLinkError("invalid");
  if (!res.ok) throw new SharedLinkError("network");
  return res;
}

export async function fetchSharedGraph(token: string, signal?: AbortSignal): Promise<SharedGraph> {
  const res = await sharedFetch("/shared/graph", token, signal);
  const body = (await res.json()) as { name?: unknown; expiresAt?: unknown; nodes?: unknown; edges?: unknown };
  const parsed = graphSnapshotSchema.safeParse({ nodes: body.nodes, edges: body.edges });
  if (!parsed.success || typeof body.name !== "string" || typeof body.expiresAt !== "string") throw new SharedLinkError("format");
  return { name: body.name, expiresAt: body.expiresAt, doc: parsed.data };
}

/** Descarga las imágenes de las entidades con el token y devuelve URL `blob:` por identificador. Las que fallen se omiten. */
export async function fetchSharedImages(token: string, imageIds: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...new Set(imageIds)];
  const worker = async () => {
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      try {
        const res = await sharedFetch(`/shared/images/${encodeURIComponent(id)}`, token, signal);
        out.set(id, URL.createObjectURL(await res.blob()));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        /* una imagen que falla no impide ver el grafo */
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}
