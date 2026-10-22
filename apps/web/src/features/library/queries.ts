import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GraphContentResponse, GraphSnapshot } from "@a-link/shared";
import { api } from "@/lib/api";
import type { DashboardData, Folder, FolderDeleteMode, GraphSort, GraphSummary, Paginated } from "@/lib/types";

export interface GraphListParams {
  /** UUID de carpeta, "root" (sin carpeta) o undefined (todos). */
  folderId?: string;
  search?: string;
  trashed?: boolean;
  sort?: GraphSort;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export const keys = {
  folders: ["folders"] as const,
  graphs: ["graphs"] as const,
  graphList: (p: GraphListParams) => ["graphs", "list", p] as const,
  graph: (id: string) => ["graphs", "detail", id] as const,
  dashboard: ["dashboard"] as const,
};

export function useFolders() {
  return useQuery({
    queryKey: keys.folders,
    queryFn: async () => (await api<{ items: Folder[] }>("/folders")).items,
  });
}

export function useGraphs(params: GraphListParams) {
  return useQuery({
    queryKey: keys.graphList(params),
    queryFn: ({ signal }) =>
      api<Paginated<GraphSummary>>("/graphs", {
        signal,
        query: { ...params, trashed: params.trashed ? "true" : undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useGraph(id: string) {
  return useQuery({
    queryKey: keys.graph(id),
    queryFn: async () => (await api<{ graph: GraphSummary }>(`/graphs/${id}`)).graph,
    retry: false,
  });
}

/**
 * Contenido del grafo para el editor. Nunca se refresca solo (ni al volver a la ventana ni al reconectar):
 * el editor es la fuente de verdad mientras está abierto y un refresco pisaría los cambios sin guardar.
 * `gcTime: 0` evita conservar en caché datos del grafo cuando se sale del editor.
 */
export function useGraphContent(id: string) {
  return useQuery({
    queryKey: ["graphs", "content", id] as const,
    queryFn: ({ signal }) => fetchGraphContent(id, signal),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function fetchGraphContent(id: string, signal?: AbortSignal) {
  return api<GraphContentResponse>(`/graphs/${id}/content`, { signal });
}

export function saveGraphContent(id: string, body: { expectedRevision: number; nodes: GraphSnapshot["nodes"]; edges: GraphSnapshot["edges"] }) {
  return api<{ revision: number; nodeCount: number; edgeCount: number }>(`/graphs/${id}/content`, { method: "PUT", body });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardData>("/dashboard") });
}

/** Tras cambiar carpetas o grafos se refrescan listados, contadores y panel. */
function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.folders }),
      qc.invalidateQueries({ queryKey: keys.graphs }),
      qc.invalidateQueries({ queryKey: keys.dashboard }),
    ]);
}

export function useCreateFolder() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (input: { name: string; parentId: string | null }) =>
      api<{ folder: Folder }>("/folders", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateFolder() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; parentId?: string | null }) =>
      api<{ folder: Folder }>(`/folders/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteFolder() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: ({ id, contents }: { id: string; contents: FolderDeleteMode }) =>
      api(`/folders/${id}`, { method: "DELETE", query: { contents } }),
    onSuccess: invalidate,
  });
}

export function useCreateGraph() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; folderId: string | null }) =>
      api<{ graph: GraphSummary }>("/graphs", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateGraph() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string; folderId?: string | null }) =>
      api<{ graph: GraphSummary }>(`/graphs/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useTrashGraph() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (id: string) => api(`/graphs/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useRestoreGraph() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (id: string) => api<{ graph: GraphSummary }>(`/graphs/${id}/restore`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useDeleteGraphPermanently() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (id: string) => api(`/graphs/${id}/permanent`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useDuplicateGraph() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: (id: string) => api<{ graph: GraphSummary }>(`/graphs/${id}/duplicate`, { method: "POST", body: {} }),
    onSuccess: invalidate,
  });
}
