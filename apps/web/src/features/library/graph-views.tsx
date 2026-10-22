import { Copy, Folder as FolderIcon, MoreVertical, Network, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNumber, formatRelative, pluralize } from "@/lib/format";
import type { GraphSummary } from "@/lib/types";

export interface GraphItemActions {
  onEdit: (graph: GraphSummary) => void;
  onDuplicate: (graph: GraphSummary) => void;
  onTrash: (graph: GraphSummary) => void;
}

function GraphMenu({ graph, actions }: { graph: GraphSummary; actions: GraphItemActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Acciones de ${graph.name}`}>
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.onEdit(graph)}>
          <Pencil aria-hidden="true" /> Editar detalles
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onDuplicate(graph)}>
          <Copy aria-hidden="true" /> Duplicar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => actions.onTrash(graph)}>
          <Trash2 aria-hidden="true" /> Enviar a la papelera
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Counts({ graph }: { graph: Pick<GraphSummary, "nodeCount" | "edgeCount"> }) {
  return (
    <span className="text-xs text-muted-foreground">
      {pluralize(graph.nodeCount, "entidad", "entidades")} · {pluralize(graph.edgeCount, "relación", "relaciones")}
    </span>
  );
}

export function GraphCard({ graph, folderName, actions }: { graph: GraphSummary; folderName: string | null; actions: GraphItemActions }) {
  return (
    <Card className="group relative flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/graphs/${graph.id}`} className="flex flex-1 flex-col outline-offset-[-2px]" aria-label={`Abrir ${graph.name}`}>
        <div className="flex h-24 items-center justify-center bg-gradient-to-br from-primary/10 via-accent to-primary/5 text-primary/60">
          <Network className="size-10" aria-hidden="true" />
        </div>
        <div className="grid flex-1 content-start gap-1.5 p-4 pb-2">
          <h3 className="truncate pr-8 font-semibold" title={graph.name}>
            {graph.name}
          </h3>
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{graph.description || "Sin descripción"}</p>
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 px-4 pb-3">
        <div className="grid gap-0.5">
          <Counts graph={graph} />
          <span className="text-xs text-muted-foreground">Actualizado {formatRelative(graph.updatedAt)}</span>
        </div>
        {folderName && (
          <Badge className="max-w-28 truncate" title={folderName}>
            <FolderIcon aria-hidden="true" />
            <span className="truncate">{folderName}</span>
          </Badge>
        )}
      </div>
      <div className="absolute top-[4.5rem] right-2 rounded-md bg-card/90 shadow-xs">
        <GraphMenu graph={graph} actions={actions} />
      </div>
    </Card>
  );
}

export function GraphRow({ graph, folderName, actions }: { graph: GraphSummary; folderName: string | null; actions: GraphItemActions }) {
  return (
    <li className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-accent/40">
      <Network className="hidden size-5 shrink-0 text-primary/70 sm:block" aria-hidden="true" />
      <Link to={`/graphs/${graph.id}`} className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{graph.name}</span>
        <span className="truncate text-xs text-muted-foreground">{graph.description || "Sin descripción"}</span>
      </Link>
      {folderName && (
        <Badge className="hidden max-w-32 md:inline-flex">
          <FolderIcon aria-hidden="true" />
          <span className="truncate">{folderName}</span>
        </Badge>
      )}
      <div className="hidden text-right lg:block">
        <Counts graph={graph} />
      </div>
      <span className="hidden w-28 text-right text-xs text-muted-foreground sm:block">{formatRelative(graph.updatedAt)}</span>
      <GraphMenu graph={graph} actions={actions} />
    </li>
  );
}

export function ResultsSummary({ total, page, pageSize }: { total: number; page: number; pageSize: number }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {total === 0 ? "Sin resultados" : `Mostrando ${formatNumber(from)}–${formatNumber(to)} de ${formatNumber(total)}`}
    </p>
  );
}
