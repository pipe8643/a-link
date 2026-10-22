import { ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, Library, MoreHorizontal, Pencil, FolderInput, Trash2, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type FolderNode, buildTree } from "@/lib/folder-tree";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";

/** `undefined` = todos los grafos; "root" = sin carpeta; si no, el id de la carpeta. */
export type FolderSelection = string | undefined;

interface Props {
  folders: Folder[];
  /** Mientras carga no se muestra el aviso de "sin carpetas" (sería un falso estado vacío). */
  loading?: boolean;
  selected: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onCreate: (parentId: string | null) => void;
  onRename: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}

const rowBase =
  "group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-accent/60";

export function FolderTree({ folders, loading = false, selected, onSelect, onCreate, onRename, onMove, onDelete }: Props) {
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: FolderNode) => {
    const { folder } = node;
    const isSelected = selected === folder.id;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(folder.id);
    return (
      <li key={folder.id}>
        <div className={cn(rowBase, isSelected && "bg-accent text-accent-foreground")} style={{ paddingLeft: `${node.depth * 0.9}rem` }}>
          <button
            type="button"
            onClick={() => toggle(folder.id)}
            disabled={!hasChildren}
            aria-label={isCollapsed ? `Expandir ${folder.name}` : `Contraer ${folder.name}`}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            className={cn("flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground", !hasChildren && "invisible")}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            aria-current={isSelected ? "true" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          >
            {isSelected ? <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="truncate">{folder.name}</span>
            <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">{folder.graphCount ?? 0}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 opacity-60 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`Acciones de la carpeta ${folder.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onCreate(folder.id)}>
                <FolderPlus aria-hidden="true" /> Nueva subcarpeta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(folder)}>
                <Pencil aria-hidden="true" /> Renombrar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(folder)}>
                <FolderInput aria-hidden="true" /> Mover…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => onDelete(folder)}>
                <Trash2 aria-hidden="true" /> Eliminar…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasChildren && !isCollapsed && <ul className="mt-0.5 grid gap-0.5">{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  const fixedRow = (value: FolderSelection, label: string, Icon: typeof Library) => (
    <li>
      <button
        type="button"
        onClick={() => onSelect(value)}
        aria-current={selected === value ? "true" : undefined}
        className={cn(rowBase, "w-full gap-2 px-2 py-1.5 text-left", selected === value && "bg-accent text-accent-foreground")}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {label}
      </button>
    </li>
  );

  return (
    <nav aria-label="Carpetas" className="grid gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Carpetas</h2>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onCreate(null)}>
          <FolderPlus aria-hidden="true" /> Nueva
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {fixedRow(undefined, "Todos los grafos", Library)}
        {fixedRow("root", "Sin carpeta", Inbox)}
        {tree.map(renderNode)}
      </ul>
      {loading && (
        <div className="grid gap-2 px-1" role="status" aria-label="Cargando carpetas">
          <Skeleton className="h-6" />
          <Skeleton className="h-6 w-4/5" />
        </div>
      )}
      {!loading && folders.length === 0 && (
        <p className="px-2 text-xs text-muted-foreground">Aún no tienes carpetas. Crea una para organizar tus grafos.</p>
      )}
    </nav>
  );
}
