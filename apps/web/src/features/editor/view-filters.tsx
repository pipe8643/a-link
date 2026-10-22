import { ENTITY_CATALOG, ENTITY_TYPE_IDS, EVIDENCE_CLASSES, EVIDENCE_LABELS_ES, type GraphSnapshot } from "@a-link/shared";
import { Eye, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { AURA_MODES, AURA_MODE_LABELS, auraGroups, type AuraMode } from "./auras";
import { hasFilters } from "./view-filter";
import type { GraphViewApi } from "./use-graph-view";

interface Props {
  doc: GraphSnapshot;
  graphView: GraphViewApi;
}

/** Texto corto del estado de la vista, o `null` si se ve todo el grafo. */
export function viewSummary(graphView: GraphViewApi, doc: GraphSnapshot): string | null {
  const { result } = graphView;
  if (!result.filtered) return null;
  const shown = doc.nodes.length - result.hiddenNodes;
  const what = result.focusActive ? "Enfocado" : "Filtrado";
  return `${what}: ${shown} de ${doc.nodes.length} entidades · ${doc.edges.length - result.hiddenEdges} de ${doc.edges.length} relaciones`;
}

/**
 * Filtros cruzados (tipo de entidad, naturaleza del dato y fechas de las relaciones) y halos. Todo es solo vista:
 * los datos no se tocan ni se pierden, y «Mostrar todo» lo devuelve a su estado inicial.
 */
export function ViewFilters({ doc, graphView }: Props) {
  const { view, result, auraMode } = graphView;
  const active = hasFilters(view);
  const [open, setOpen] = useState(false);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of doc.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [doc.nodes]);
  const evidenceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of doc.edges) {
      const k = e.metadata.evidenceClass ?? "hypothesis";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [doc.edges]);
  const groups = useMemo(() => auraGroups(doc, auraMode), [doc, auraMode]);

  const badDates = view.dateFrom !== "" && view.dateTo !== "" && view.dateFrom > view.dateTo;
  const datesActive = view.dateFrom !== "" || view.dateTo !== "";

  return (
    <details className="group rounded-md border bg-card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <Eye className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">Vista y filtros</span>
        {(active || result.focusActive) && <span className="rounded bg-primary px-1.5 text-xs text-primary-foreground">activos</span>}
      </summary>

      <div className="grid gap-3 border-t p-2 text-sm">
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tipo de entidad</legend>
          {ENTITY_TYPE_IDS.filter((t) => typeCounts.has(t) || view.hiddenTypes.includes(t)).map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={!view.hiddenTypes.includes(t)} onChange={() => graphView.toggleType(t)} />
              <span className="flex-1 truncate">{ENTITY_CATALOG[t].name}</span>
              <span className="text-xs text-muted-foreground">{typeCounts.get(t) ?? 0}</span>
            </label>
          ))}
          {typeCounts.size === 0 && <p className="text-xs text-muted-foreground">Aún no hay entidades.</p>}
        </fieldset>

        <fieldset className="grid gap-1">
          <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Naturaleza del dato</legend>
          {EVIDENCE_CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={!view.hiddenEvidence.includes(c)} onChange={() => graphView.toggleEvidence(c)} />
              <span className="flex-1 truncate">{EVIDENCE_LABELS_ES[c]}</span>
              <span className="text-xs text-muted-foreground">{evidenceCounts.get(c) ?? 0}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Fechas de las relaciones</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-0.5 text-xs">
              Desde
              <Input type="date" value={view.dateFrom} max={view.dateTo || undefined} onChange={(e) => graphView.setDates(e.target.value, view.dateTo)} />
            </label>
            <label className="grid gap-0.5 text-xs">
              Hasta
              <Input type="date" value={view.dateTo} min={view.dateFrom || undefined} onChange={(e) => graphView.setDates(view.dateFrom, e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={view.includeUndated} onChange={(e) => graphView.setIncludeUndated(e.target.checked)} disabled={!datesActive} />
            <span>Incluir relaciones sin fecha</span>
          </label>
          {badDates && (
            <p role="alert" className="text-xs text-destructive">
              La fecha «desde» es posterior a «hasta»: no se mostrará ninguna relación con fechas.
            </p>
          )}
        </fieldset>

        <div className="grid gap-1.5">
          <label htmlFor="aura-mode" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Halos
          </label>
          <NativeSelect id="aura-mode" value={auraMode} onChange={(e) => graphView.setAuraMode(e.target.value as AuraMode)}>
            {AURA_MODES.map((m) => (
              <option key={m} value={m}>
                {AURA_MODE_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
          {auraMode !== "none" && (
            <ul aria-label="Leyenda de halos" className="grid gap-0.5 text-xs">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full border" style={{ backgroundColor: g.color, opacity: 0.8 }} aria-hidden="true" />
                  <span className="flex-1 truncate">{g.label}</span>
                  <span className="text-muted-foreground">{g.count}</span>
                </li>
              ))}
              {groups.length === 0 && <li className="text-muted-foreground">{auraMode === "tag" ? "Ninguna entidad tiene etiquetas." : "Sin entidades."}</li>}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={graphView.clearFilters} disabled={!active}>
            <RotateCcw aria-hidden="true" /> Quitar filtros
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={graphView.showAll} disabled={!result.filtered}>
            Mostrar todo
          </Button>
        </div>
      </div>
    </details>
  );
}
