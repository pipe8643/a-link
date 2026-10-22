import { ENTITY_CATALOG, ENTITY_TYPE_IDS, RELATIONSHIP_LABELS_ES, EVIDENCE_LABELS_ES, type EntityTypeId } from "@a-link/shared";
import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input, NativeSelect } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ShapeIcon } from "./shape-icon";
import type { EditorApi } from "./use-editor";
import type { GraphViewApi } from "./use-graph-view";
import { ViewFilters } from "./view-filters";

interface Props {
  editor: EditorApi;
  onAddEntity(type: EntityTypeId): void;
  /** Un clic en una entidad de la lista (selecciona o, en modo conectar, actúa como origen/destino). */
  onPickNode(id: string): void;
  onPickEdge(id: string): void;
  connectSourceId: string | null;
  /** Vista del grafo (filtros, enfoque, halos). Sin ella, el panel no ofrece filtros. */
  graphView?: GraphViewApi;
}

/** Panel izquierdo: paleta de tipos, lista de entidades y de relaciones con búsqueda y filtro por tipo. */
export function LeftPanel({ editor, onAddEntity, onPickNode, onPickEdge, connectSourceId, graphView }: Props) {
  const [tab, setTab] = useState<"nodes" | "edges">("nodes");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | EntityTypeId>("");
  const { doc, nodesById, selection } = editor;

  const q = query.trim().toLocaleLowerCase("es");
  const nodes = useMemo(
    () =>
      doc.nodes
        .filter((n) => (typeFilter === "" || n.type === typeFilter) && (q === "" || n.label.toLocaleLowerCase("es").includes(q) || n.tags.some((t) => t.toLocaleLowerCase("es").includes(q))))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [doc.nodes, typeFilter, q],
  );
  const edges = useMemo(
    () =>
      doc.edges.filter((e) => {
        if (q === "") return true;
        const a = nodesById.get(e.sourceId)?.label ?? "";
        const b = nodesById.get(e.targetId)?.label ?? "";
        return [a, b, e.label, RELATIONSHIP_LABELS_ES[e.relationshipType]].some((s) => s.toLocaleLowerCase("es").includes(q));
      }),
    [doc.edges, nodesById, q],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <section aria-labelledby="paleta-titulo">
        <h2 id="paleta-titulo" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Añadir entidad
        </h2>
        <ul className="grid grid-cols-2 gap-1.5">
          {ENTITY_TYPE_IDS.map((type) => (
            <li key={type}>
              <button
                type="button"
                onClick={() => onAddEntity(type)}
                className="flex w-full items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                <ShapeIcon type={type} size={24} className="shrink-0" />
                <span className="truncate">{ENTITY_CATALOG[type].name}</span>
                <span className="sr-only">: añadir al grafo</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {graphView && <ViewFilters doc={doc} graphView={graphView} />}

      <div role="tablist" aria-label="Contenido del grafo" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
        {(
          [
            ["nodes", `Entidades (${doc.nodes.length})`],
            ["edges", `Relaciones (${doc.edges.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cn("rounded px-2 py-1 font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", tab === id ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Buscar en el grafo" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" maxLength={100} />
        </div>
        {tab === "nodes" && (
          <NativeSelect aria-label="Filtrar por tipo" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "" | EntityTypeId)}>
            <option value="">Todos los tipos</option>
            {ENTITY_TYPE_IDS.map((t) => (
              <option key={t} value={t}>
                {ENTITY_CATALOG[t].name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-40 flex-1 overflow-y-auto">
        {tab === "nodes" ? (
          nodes.length === 0 ? (
            <Empty text={doc.nodes.length === 0 ? "Todavía no hay entidades. Añade la primera desde la paleta." : "Ninguna entidad coincide con la búsqueda."} />
          ) : (
            <ul className="grid gap-1" aria-label="Entidades">
              {nodes.map((n) => {
                const selected = selection.nodeIds.includes(n.id);
                const hidden = graphView ? !graphView.result.visibleNodeIds.has(n.id) : false;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onPickNode(n.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                        selected && "bg-accent font-medium",
                        hidden && "text-muted-foreground italic",
                        connectSourceId === n.id && "ring-2 ring-primary",
                      )}
                    >
                      <ShapeIcon type={n.type} size={22} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{n.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{hidden ? "Oculta · " : ""}{ENTITY_CATALOG[n.type].name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : edges.length === 0 ? (
          <Empty text={doc.edges.length === 0 ? "Todavía no hay relaciones. Selecciona una entidad y usa «Conectar»." : "Ninguna relación coincide con la búsqueda."} />
        ) : (
          <ul className="grid gap-1" aria-label="Relaciones">
            {edges.map((e) => {
              const selected = selection.edgeIds.includes(e.id);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onPickEdge(e.id)}
                    aria-pressed={selected}
                    className={cn("grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden", selected && "bg-accent")}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate">{nodesById.get(e.sourceId)?.label}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="hacia" />
                      <span className="min-w-0 truncate">{nodesById.get(e.targetId)?.label}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.label || RELATIONSHIP_LABELS_ES[e.relationshipType]} · {EVIDENCE_LABELS_ES[e.metadata.evidenceClass ?? "hypothesis"]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-4 text-center text-sm text-muted-foreground">{text}</p>;
}
