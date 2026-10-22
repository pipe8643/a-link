import { ENTITY_CATALOG, EVIDENCE_LABELS_ES, type EntityTypeId, type EvidenceClass, type GraphSnapshot } from "@a-link/shared";

export interface TypeLegendEntry {
  type: EntityTypeId;
  name: string;
  color: string;
  count: number;
}

export interface EvidenceLegendEntry {
  evidence: EvidenceClass;
  name: string;
  /** Patrón de trazo en el mismo orden que el lienzo (vacío = continuo). */
  dash: readonly number[];
  count: number;
}

export interface Legend {
  types: TypeLegendEntry[];
  evidence: EvidenceLegendEntry[];
}

/** Trazo por naturaleza del dato; mismo criterio que `zoom-data.ts` (la certeza no depende solo del color). */
export const EVIDENCE_DASH: Readonly<Record<EvidenceClass, readonly number[]>> = {
  recorded: [],
  hypothesis: [10, 6],
  observation: [2, 6],
};

const EVIDENCE_ORDER: readonly EvidenceClass[] = ["recorded", "hypothesis", "observation"];

/** Solo aparece en la leyenda lo que realmente hay en el grafo (tipos de entidad y naturaleza de las relaciones). */
export function buildLegend(doc: GraphSnapshot): Legend {
  const typeCounts = new Map<EntityTypeId, number>();
  for (const n of doc.nodes) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);
  const types = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, name: ENTITY_CATALOG[type].name, color: ENTITY_CATALOG[type].defaultColor, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const evCounts = new Map<EvidenceClass, number>();
  for (const e of doc.edges) {
    const ev = e.metadata.evidenceClass ?? "hypothesis";
    evCounts.set(ev, (evCounts.get(ev) ?? 0) + 1);
  }
  const evidence = EVIDENCE_ORDER.filter((ev) => evCounts.has(ev)).map((ev) => ({
    evidence: ev,
    name: EVIDENCE_LABELS_ES[ev],
    dash: EVIDENCE_DASH[ev],
    count: evCounts.get(ev) ?? 0,
  }));
  return { types, evidence };
}
