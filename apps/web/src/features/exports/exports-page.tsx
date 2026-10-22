import { ChevronLeft, ChevronRight, Download, FileDown, FileImage, FileText, Pencil, Presentation, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { FormError, TextField } from "@/components/form-fields";
import { EmptyState, PageHeader, QueryError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/form-errors";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { ConfirmDialog } from "../library/dialogs";
import { STORED_FORMATS, STORED_FORMAT_LABELS, type StoredFile, type StoredFormat, downloadStoredFile, storedFileName, useDeleteFile, useFiles, useRenameFile } from "./queries";

const PAGE_SIZE = 20;

const FORMAT_ICON = { png: FileImage, jpeg: FileImage, pdf: FileText, pptx: Presentation } as const satisfies Record<StoredFormat, unknown>;

export function ExportsPage() {
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState<StoredFormat | "">("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 300);
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  const [deleting, setDeleting] = useState<StoredFile | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const del = useDeleteFile();

  useEffect(() => setPage(1), [debounced, format]);

  const files = useFiles({ ...(debounced ? { search: debounced } : {}), ...(format ? { format } : {}), page, pageSize: PAGE_SIZE });
  const data = files.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtering = debounced !== "" || format !== "";

  // Si se elimina el último archivo de la última página, se retrocede.
  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  const download = async (file: StoredFile) => {
    setDownloading(file.id);
    try {
      await downloadStoredFile(file);
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Exportaciones"
        description="Copias de tus grafos que guardaste desde el editor (opción «Guardar una copia en mi cuenta» al exportar). Solo tú puedes verlas y descargarlas."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label="Buscar exportaciones" placeholder="Buscar por nombre…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label="Formato" className="w-auto" value={format} onChange={(e) => setFormat(e.target.value as StoredFormat | "")}>
          <option value="">Todos los formatos</option>
          {STORED_FORMATS.map((f) => (
            <option key={f} value={f}>
              {STORED_FORMAT_LABELS[f]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {files.isPending ? (
        <div className="grid gap-2" role="status" aria-label="Cargando">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : files.isError ? (
        <QueryError error={files.error} onRetry={() => void files.refetch()} />
      ) : files.data.items.length === 0 ? (
        <EmptyState
          icon={FileDown}
          title={filtering ? "Ninguna exportación coincide" : "Aún no has guardado exportaciones"}
          description={filtering ? "Prueba con otro nombre o formato." : "Abre un grafo, pulsa «Exportar…» y marca «Guardar una copia en mi cuenta»."}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul aria-label="Exportaciones guardadas">
              {files.data.items.map((file) => {
                const Icon = FORMAT_ICON[file.format];
                return (
                  <li key={file.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0">
                    <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{storedFileName(file)}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.graphTrashed ? (
                          <span>{file.graphName} (en la papelera)</span>
                        ) : (
                          <Link to={`/graphs/${file.graphId}`} className="underline-offset-2 hover:underline">
                            {file.graphName}
                          </Link>
                        )}
                        {` · ${STORED_FORMAT_LABELS[file.format]} · ${formatBytes(file.fileSize)} · ${formatDateTime(file.createdAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" loading={downloading === file.id} onClick={() => void download(file)} aria-label={`Descargar ${storedFileName(file)}`}>
                        <Download aria-hidden="true" /> Descargar
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setRenaming(file)} aria-label={`Renombrar ${storedFileName(file)}`}>
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleting(file)} aria-label={`Eliminar ${storedFileName(file)}`}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {formatNumber(files.data.total)} {files.data.total === 1 ? "exportación" : "exportaciones"}
            </p>
            {totalPages > 1 && (
              <nav className="flex items-center gap-2" aria-label="Paginación">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft aria-hidden="true" /> Anterior
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Página {page} de {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Siguiente <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </div>
        </>
      )}

      {renaming && <RenameDialog file={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Eliminar «${storedFileName(deleting)}»`}
          description="Se borra la copia guardada en tu cuenta. El grafo no se modifica y no se puede deshacer."
          confirmLabel="Eliminar"
          destructive
          onConfirm={async () => {
            await del.mutateAsync(deleting.id);
            toast.success("Exportación eliminada");
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const rename = useRenameFile();
  const [name, setName] = useState(file.name);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && !rename.isPending && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!trimmed) return setError("Escribe un nombre.");
            setError(null);
            try {
              await rename.mutateAsync({ id: file.id, name: trimmed });
              toast.success("Exportación renombrada");
              onClose();
            } catch (err) {
              setError(describeError(err));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Renombrar exportación</DialogTitle>
            <DialogDescription>Solo cambia el nombre; la extensión (.{storedFileName(file).split(".").pop()}) se mantiene según el contenido.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <TextField label="Nombre" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={rename.isPending}>
              Cancelar
            </Button>
            <Button type="submit" loading={rename.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
