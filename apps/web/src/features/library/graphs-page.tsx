import { ChevronLeft, ChevronRight, FolderTree as FolderTreeIcon, LayoutGrid, List, Network, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CardGridSkeleton, EmptyState, PageHeader, QueryError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { folderName, folderPath } from "@/lib/folder-tree";
import type { Folder, GraphSort, GraphSummary } from "@/lib/types";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";
import {
  DeleteFolderDialog,
  FolderDialog,
  type FolderDialogMode,
  GraphDialog,
  type GraphDialogMode,
  MoveFolderDialog,
} from "./dialogs";
import { FolderTree, type FolderSelection } from "./folder-tree";
import { GraphCard, GraphRow, ResultsSummary } from "./graph-views";
import { useFolders, useGraphs } from "./queries";
import { useGraphActions } from "./use-graph-actions";

const PAGE_SIZE = 12;

const SORT_OPTIONS = {
  "updated-desc": { label: "Más recientes", sort: "updatedAt", order: "desc" },
  "updated-asc": { label: "Más antiguos", sort: "updatedAt", order: "asc" },
  "name-asc": { label: "Nombre (A-Z)", sort: "name", order: "asc" },
  "name-desc": { label: "Nombre (Z-A)", sort: "name", order: "desc" },
  "created-desc": { label: "Creados recientemente", sort: "createdAt", order: "desc" },
} as const satisfies Record<string, { label: string; sort: GraphSort; order: "asc" | "desc" }>;
type SortKey = keyof typeof SORT_OPTIONS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIEW_KEY = "alink-view";

type DialogState =
  | { kind: "folder"; mode: FolderDialogMode }
  | { kind: "moveFolder"; folder: Folder }
  | { kind: "deleteFolder"; folder: Folder }
  | { kind: "graph"; mode: GraphDialogMode }
  | null;

function readView(): "grid" | "list" {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function GraphsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const foldersQuery = useFolders();
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const actions = useGraphActions();

  const rawFolder = params.get("folder");
  const selected: FolderSelection = rawFolder === "root" ? "root" : rawFolder && UUID_RE.test(rawFolder) ? rawFolder : undefined;
  const sortKey: SortKey = (params.get("sort") as SortKey) in SORT_OPTIONS ? (params.get("sort") as SortKey) : "updated-desc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const urlQuery = params.get("q") ?? "";

  const [view, setView] = useState<"grid" | "list">(readView);
  const [search, setSearch] = useState(urlQuery);
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        if (resetPage && !("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  // La búsqueda escrita se refleja en la URL (con retraso) para poder compartir/recargar la vista.
  useEffect(() => {
    if (debouncedSearch !== urlQuery) update({ q: debouncedSearch || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Si la carpeta seleccionada desaparece (p. ej. se eliminó), se vuelve a "Todos".
  useEffect(() => {
    if (selected && selected !== "root" && foldersQuery.isSuccess && !folders.some((f) => f.id === selected)) {
      update({ folder: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, folders, foldersQuery.isSuccess]);

  const { sort, order } = SORT_OPTIONS[sortKey];
  const graphs = useGraphs({ folderId: selected, search: urlQuery || undefined, sort, order, page, pageSize: PAGE_SIZE });
  const data = graphs.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Si se elimina el último elemento de la última página, se retrocede a la anterior.
  useEffect(() => {
    if (data && page > totalPages) update({ page: String(totalPages) }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, totalPages]);

  const setViewMode = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const itemActions = {
    onEdit: (graph: GraphSummary) => setDialog({ kind: "graph", mode: { type: "edit", graph } }),
    onDuplicate: (graph: GraphSummary) => void actions.duplicate(graph),
    onTrash: (graph: GraphSummary) => void actions.trash(graph),
  };

  const path = selected && selected !== "root" ? folderPath(folders, selected) : [];
  const title = selected === "root" ? "Sin carpeta" : path.length ? path[path.length - 1]!.name : "Todos los grafos";
  const breadcrumb = path.length > 1 ? path.map((f) => f.name).join(" / ") : null;

  const tree = (
    <FolderTree
      folders={folders}
      loading={foldersQuery.isPending}
      selected={selected}
      onSelect={(s) => {
        update({ folder: s ?? null });
        setFoldersOpen(false);
      }}
      onCreate={(parentId) => setDialog({ kind: "folder", mode: { type: "create", parentId } })}
      onRename={(folder) => setDialog({ kind: "folder", mode: { type: "rename", folder } })}
      onMove={(folder) => setDialog({ kind: "moveFolder", folder })}
      onDelete={(folder) => setDialog({ kind: "deleteFolder", folder })}
    />
  );

  const hasFilters = !!urlQuery || selected !== undefined;
  const newGraph = () =>
    setDialog({ kind: "graph", mode: { type: "create", folderId: selected && selected !== "root" ? selected : null } });

  return (
    <div className="grid gap-6 xl:grid-cols-[16rem_1fr]">
      <aside className="hidden xl:block">
        <Card className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-x-hidden overflow-y-auto p-3">{tree}</Card>
      </aside>

      <section className="grid min-w-0 content-start gap-5" aria-labelledby="graphs-title">
        <PageHeader
          title={title}
          description={breadcrumb ?? (data ? undefined : undefined)}
          actions={
            <>
              <Sheet open={foldersOpen} onOpenChange={setFoldersOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="xl:hidden">
                    <FolderTreeIcon aria-hidden="true" /> Carpetas
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetTitle>Carpetas</SheetTitle>
                  <SheetDescription>Navega y organiza tus carpetas</SheetDescription>
                  <div className="mt-6 overflow-y-auto">{tree}</div>
                </SheetContent>
              </Sheet>
              <Button onClick={newGraph}>
                <Plus aria-hidden="true" /> Nuevo grafo
              </Button>
            </>
          }
        />
        <h2 id="graphs-title" className="sr-only">
          Listado de grafos
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar grafos…"
              aria-label="Buscar grafos"
              maxLength={100}
              className="pr-9 pl-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Borrar búsqueda"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <NativeSelect
            aria-label="Ordenar por"
            value={sortKey}
            onChange={(e) => update({ sort: e.target.value === "updated-desc" ? null : e.target.value })}
            className="w-auto"
          >
            {(Object.keys(SORT_OPTIONS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_OPTIONS[k].label}
              </option>
            ))}
          </NativeSelect>
          <div className="ml-auto flex rounded-md border bg-card p-0.5" role="group" aria-label="Tipo de vista">
            {(
              [
                ["grid", LayoutGrid, "Vista de tarjetas"],
                ["list", List, "Vista de lista"],
              ] as const
            ).map(([v, Icon, label]) => (
              <Button
                key={v}
                variant={view === v ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                aria-label={label}
                aria-pressed={view === v}
                onClick={() => setViewMode(v)}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>

        {graphs.isPending ? (
          <CardGridSkeleton />
        ) : graphs.isError ? (
          <QueryError error={graphs.error} onRetry={() => void graphs.refetch()} />
        ) : graphs.data.items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={Search}
              title="No hay grafos que coincidan"
              description="Prueba con otra búsqueda o cambia de carpeta."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    update({ q: null, folder: null });
                  }}
                >
                  Quitar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Network}
              title="Crea tu primer grafo"
              description="Un grafo reúne personas, propiedades, vehículos, teléfonos y otras entidades, y las relaciones entre ellas."
              action={
                <Button onClick={newGraph}>
                  <Plus aria-hidden="true" /> Nuevo grafo
                </Button>
              }
            />
          )
        ) : (
          <div className={cn("grid gap-4", graphs.isPlaceholderData && "opacity-60 transition-opacity")} aria-busy={graphs.isPlaceholderData}>
            {view === "grid" ? (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {graphs.data.items.map((g) => (
                  <li key={g.id} className="contents">
                    <GraphCard graph={g} folderName={folderName(folders, g.folderId)} actions={itemActions} />
                  </li>
                ))}
              </ul>
            ) : (
              <Card className="overflow-hidden">
                <ul>
                  {graphs.data.items.map((g) => (
                    <GraphRow key={g.id} graph={g} folderName={folderName(folders, g.folderId)} actions={itemActions} />
                  ))}
                </ul>
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <ResultsSummary total={graphs.data.total} page={graphs.data.page} pageSize={graphs.data.pageSize} />
              {totalPages > 1 && (
                <nav className="flex items-center gap-2" aria-label="Paginación">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
                    <ChevronLeft aria-hidden="true" /> Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Página {page} de {totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) }, false)}>
                    Siguiente <ChevronRight aria-hidden="true" />
                  </Button>
                </nav>
              )}
            </div>
          </div>
        )}
      </section>

      {dialog?.kind === "folder" && (
        <FolderDialog open onOpenChange={(o) => !o && setDialog(null)} mode={dialog.mode} />
      )}
      {dialog?.kind === "moveFolder" && (
        <MoveFolderDialog open onOpenChange={(o) => !o && setDialog(null)} folder={dialog.folder} folders={folders} />
      )}
      {dialog?.kind === "deleteFolder" && (
        <DeleteFolderDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          folder={dialog.folder}
          folders={folders}
          onDeleted={() => {
            if (selected === dialog.folder.id) update({ folder: null });
          }}
        />
      )}
      {dialog?.kind === "graph" && (
        <GraphDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          mode={dialog.mode}
          folders={folders}
          onCreated={(g) => navigate(`/graphs/${g.id}`)}
        />
      )}
    </div>
  );
}
