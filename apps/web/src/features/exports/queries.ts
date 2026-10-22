import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiBlob } from "@/lib/api";
import type { Paginated } from "@/lib/types";
import { downloadBlob } from "../export/download";

export type StoredFormat = "png" | "jpeg" | "pdf" | "pptx";

/** Archivo guardado en el almacenamiento privado (metadatos; el contenido se pide aparte y solo al descargar). */
export interface StoredFile {
  id: string;
  graphId: string;
  graphName: string;
  graphTrashed: boolean;
  folderId: string | null;
  name: string;
  format: StoredFormat;
  fileSize: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}

export const STORED_FORMATS: readonly StoredFormat[] = ["png", "jpeg", "pdf", "pptx"];
export const STORED_FORMAT_LABELS: Readonly<Record<StoredFormat, string>> = { png: "PNG", jpeg: "JPEG", pdf: "PDF", pptx: "PowerPoint" };
const EXTENSION: Readonly<Record<StoredFormat, string>> = { png: "png", jpeg: "jpg", pdf: "pdf", pptx: "pptx" };

/** Nombre con el que se guarda en el equipo (el servidor guarda el nombre sin extensión). */
export function storedFileName(file: Pick<StoredFile, "name" | "format">): string {
  return `${file.name}.${EXTENSION[file.format]}`;
}

export interface FileListParams {
  search?: string;
  format?: StoredFormat;
  graphId?: string;
  page?: number;
  pageSize?: number;
}

export const fileKeys = {
  all: ["files"] as const,
  list: (p: FileListParams) => ["files", "list", p] as const,
};

export function useFiles(params: FileListParams) {
  return useQuery({
    queryKey: fileKeys.list(params),
    queryFn: ({ signal }) => api<Paginated<StoredFile>>("/files", { signal, query: { ...params } }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Guarda una copia privada del fichero YA generado en el navegador. El nombre viaja en una cabecera (codificado) y
 * no en la URL; el servidor comprueba que el contenido real coincide con el tipo indicado.
 */
export async function uploadExport(graphId: string, bytes: Uint8Array, mime: string, fileName: string, signal?: AbortSignal): Promise<StoredFile> {
  const { file } = await api<{ file: StoredFile }>(`/graphs/${graphId}/exports`, {
    method: "POST",
    binary: { data: bytes, contentType: mime, headers: { "X-Export-Name": encodeURIComponent(fileName) } },
    ...(signal ? { signal } : {}),
  });
  return file;
}

/** Descarga el archivo guardado (autenticado: la cookie de sesión acompaña la petición) y lo guarda en el equipo. */
export async function downloadStoredFile(file: Pick<StoredFile, "id" | "name" | "format">): Promise<void> {
  const blob = await apiBlob(`/files/${file.id}/content`);
  downloadBlob(blob, storedFileName(file));
}

function useInvalidateFiles() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: fileKeys.all }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
}

export function useRenameFile() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api<{ file: StoredFile }>(`/files/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: invalidate,
  });
}

export function useDeleteFile() {
  const invalidate = useInvalidateFiles();
  return useMutation({
    mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** Tras guardar una copia desde el editor, los listados y el panel se refrescan. */
export function useOnExportSaved() {
  const invalidate = useInvalidateFiles();
  return () => void invalidate();
}
