import { ENTITY_CATALOG, RELATIONSHIP_LABELS_ES, sensitiveKeysFor, type EvidenceClass, type GraphSnapshot } from "@a-link/shared";
import type { Positions } from "./layout";

const HIDDEN_KEYS = ["observations"] as const;

export interface StandaloneNode {
  id: string;
  type: string;
  label: string;
  tags: string[];
  x: number;
  y: number;
  color: string;
  image?: string;
  fields: Array<{ label: string; value: string }>;
}

export interface StandaloneEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  evidence: EvidenceClass;
  direction: "forward" | "none" | "both";
}

export interface StandaloneType {
  id: string;
  name: string;
  color: string;
}

export interface StandalonePayload {
  title: string;
  generatedAt: string;
  note?: string;
  letterhead: string | null;
  types: StandaloneType[];
  nodes: StandaloneNode[];
  edges: StandaloneEdge[];
}

/** Grafo de solo lectura: sin notas, sin campos sensibles y sin datos de las relaciones que no hacen falta para verlo. */
export function toStandalonePayload(
  doc: GraphSnapshot,
  positions: Positions,
  images: ReadonlyMap<string, string>,
  opts: { title: string; generatedAt: Date; letterhead?: string | null; note?: string; edgeLabels: boolean },
): StandalonePayload {
  const used = new Set(doc.nodes.map((n) => n.type));
  return {
    title: opts.title,
    generatedAt: opts.generatedAt.toISOString(),
    ...(opts.note ? { note: opts.note } : {}),
    letterhead: opts.letterhead ?? null,
    types: [...used].map((id) => ({ id, name: ENTITY_CATALOG[id].name, color: ENTITY_CATALOG[id].defaultColor })),
    nodes: doc.nodes.map((n) => {
      const hidden = new Set([...sensitiveKeysFor(n.type), ...HIDDEN_KEYS]);
      const def = ENTITY_CATALOG[n.type];
      const fields = def.fields.flatMap((f) => {
        if (hidden.has(f.key)) return [];
        const value = n.metadata[f.key];
        return value ? [{ label: f.label, value }] : [];
      });
      const pos = positions.get(n.id) ?? { x: n.positionX ?? 0, y: n.positionY ?? 0 };
      const image = images.get(n.id);
      return {
        id: n.id,
        type: n.type,
        label: n.label,
        tags: n.tags,
        x: pos.x,
        y: pos.y,
        color: def.defaultColor,
        ...(image ? { image } : {}),
        fields,
      };
    }),
    edges: doc.edges.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      label: opts.edgeLabels ? e.label || RELATIONSHIP_LABELS_ES[e.relationshipType] : "",
      evidence: (e.metadata.evidenceClass ?? "hypothesis") as EvidenceClass,
      direction: e.metadata.direction === "none" || e.metadata.direction === "both" ? e.metadata.direction : "forward",
    })),
  };
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
