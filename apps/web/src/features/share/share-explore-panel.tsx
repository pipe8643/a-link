import { ENTITY_CATALOG, ENTITY_TYPE_IDS, type GraphSnapshot } from "@a-link/shared";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { viewSummary } from "../editor/view-filters";
import type { GraphViewApi } from "../editor/use-graph-view";

interface Props {
  doc: GraphSnapshot;
  graphView: GraphViewApi;
}

/**
 * Leyenda de categorías del visor compartido: activar/desactivar tipos de entidad (como en las demos de
 * ZoomCharts). Solo cambia la vista; el grafo guardado no se toca.
 */
export function ShareExplorePanel({ doc, graphView }: Props) {
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of doc.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [doc.nodes]);
  const types = ENTITY_TYPE_IDS.filter((t) => typeCounts.has(t) || graphView.view.hiddenTypes.includes(t));
  const summary = viewSummary(graphView, doc);

  return (
    <aside aria-label="Filtros del grafo" className="absolute bottom-3 left-3 z-10 grid max-w-72 gap-2 rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur-sm">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Categorías</h2>
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const on = !graphView.view.hiddenTypes.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => graphView.toggleType(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                on ? "bg-background" : "bg-muted text-muted-foreground line-through opacity-70",
              )}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: ENTITY_CATALOG[t].defaultColor }} aria-hidden="true" />
              {ENTITY_CATALOG[t].name}
              <span className="tabular-nums text-muted-foreground">{typeCounts.get(t) ?? 0}</span>
            </button>
          );
        })}
      </div>
      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      {graphView.result.filtered && (
        <Button type="button" variant="outline" size="sm" onClick={graphView.showAll}>
          Mostrar todo
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Arrastra las entidades (el diseño de ZoomCharts las anima). Doble clic en un nodo principal para retraer el grafo a él
        y sus vecinos; en un vecino, para extender o contraer más conexiones.
      </p>
    </aside>
  );
}
