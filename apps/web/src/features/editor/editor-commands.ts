import {
  ENTITY_CATALOG,
  GRAPH_LIMITS,
  edgeInputSchema,
  nodeInputSchema,
  type EdgeDirection,
  type EntityTypeId,
  type EvidenceClass,
  type GraphEdgeData,
  type GraphNodeData,
  type RelationshipType,
} from "@a-link/shared";

/** Identificador cliente de entidades/relaciones (UUID v4). `randomUUID` exige contexto seguro; hay alternativa. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type FormErrors = Record<string, string>;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FormErrors };

interface Issue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/** Convierte incidencias de Zod en `campo → mensaje` (el primero gana). Nunca incluye el valor introducido. */
export function issuesToErrors(issues: readonly Issue[]): FormErrors {
  const out: FormErrors = {};
  for (const issue of issues) {
    const [first, second] = issue.path;
    const key =
      first === "metadata" && typeof second === "string" ? `metadata.${second}` : typeof first === "string" ? first : "_form";
    out[key] ??= issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------------------------
/** Nombre inicial legible y distinto de los existentes: «Persona», «Persona 2», … */
export function defaultLabel(type: EntityTypeId, existing: readonly GraphNodeData[]): string {
  const base = ENTITY_CATALOG[type].name;
  const taken = new Set(existing.map((n) => n.label.toLocaleLowerCase("es")));
  if (!taken.has(base.toLocaleLowerCase("es"))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLocaleLowerCase("es"))) return candidate;
  }
}

export function buildNode(type: EntityTypeId, existing: readonly GraphNodeData[]): ParseResult<GraphNodeData> {
  if (existing.length >= GRAPH_LIMITS.maxNodes) {
    return { ok: false, errors: { _form: `Se alcanzó el máximo de ${GRAPH_LIMITS.maxNodes} entidades por grafo.` } };
  }
  const r = nodeInputSchema.safeParse({ id: newId(), type, label: defaultLabel(type, existing) });
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: issuesToErrors(r.error.issues) };
}

export interface EntityFormValues {
  label: string;
  description: string;
  notes: string;
  /** Etiquetas separadas por comas. */
  tags: string;
  metadata: Record<string, string>;
}

export function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function entityToForm(node: GraphNodeData): EntityFormValues {
  const metadata: Record<string, string> = {};
  for (const field of ENTITY_CATALOG[node.type].fields) metadata[field.key] = node.metadata[field.key] ?? "";
  return { label: node.label, description: node.description, notes: node.notes, tags: node.tags.join(", "), metadata };
}

/** El tipo y la posición no se editan desde el formulario: se conservan del nodo original. */
export function parseEntityForm(base: GraphNodeData, values: EntityFormValues): ParseResult<GraphNodeData> {
  const r = nodeInputSchema.safeParse({
    id: base.id,
    type: base.type,
    label: values.label,
    description: values.description,
    notes: values.notes,
    tags: splitTags(values.tags),
    metadata: values.metadata,
    imageId: base.imageId,
    positionX: base.positionX,
    positionY: base.positionY,
  });
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: issuesToErrors(r.error.issues) };
}

// ---------------------------------------------------------------------------------------------
// Relaciones
// ---------------------------------------------------------------------------------------------
export interface RelationshipFormValues {
  sourceId: string;
  targetId: string;
  relationshipType: RelationshipType;
  label: string;
  description: string;
  direction: EdgeDirection;
  evidenceClass: EvidenceClass;
  startDate: string;
  endDate: string;
  source: string;
  confidence: string;
}

export function emptyRelationshipForm(sourceId = "", targetId = ""): RelationshipFormValues {
  return {
    sourceId,
    targetId,
    relationshipType: "association",
    label: "",
    description: "",
    direction: "forward",
    // Nunca se presume que algo es un hecho verificado: el valor por defecto es «hipótesis».
    evidenceClass: "hypothesis",
    startDate: "",
    endDate: "",
    source: "",
    confidence: "",
  };
}

export function relationshipToForm(edge: GraphEdgeData): RelationshipFormValues {
  const m = edge.metadata;
  return {
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    relationshipType: edge.relationshipType,
    label: edge.label,
    description: m.description ?? "",
    direction: m.direction ?? "forward",
    evidenceClass: m.evidenceClass ?? "hypothesis",
    startDate: m.startDate ?? "",
    endDate: m.endDate ?? "",
    source: m.source ?? "",
    confidence: m.confidence === undefined ? "" : String(m.confidence),
  };
}

const blank = (v: string) => (v.trim() === "" ? undefined : v);

export function parseRelationshipForm(
  id: string,
  values: RelationshipFormValues,
  existingEdges: readonly GraphEdgeData[],
  isNew: boolean,
): ParseResult<GraphEdgeData> {
  if (isNew && existingEdges.length >= GRAPH_LIMITS.maxEdges) {
    return { ok: false, errors: { _form: `Se alcanzó el máximo de ${GRAPH_LIMITS.maxEdges} relaciones por grafo.` } };
  }
  const confidenceRaw = values.confidence.trim();
  const confidence = confidenceRaw === "" ? undefined : Number(confidenceRaw);
  if (confidence !== undefined && !Number.isInteger(confidence)) {
    return { ok: false, errors: { "metadata.confidence": "La confianza debe ser un entero entre 0 y 100." } };
  }
  const r = edgeInputSchema.safeParse({
    id,
    sourceId: values.sourceId,
    targetId: values.targetId,
    relationshipType: values.relationshipType,
    label: values.label,
    metadata: {
      description: blank(values.description),
      direction: values.direction,
      evidenceClass: values.evidenceClass,
      startDate: blank(values.startDate),
      endDate: blank(values.endDate),
      source: blank(values.source),
      confidence,
    },
  });
  if (!r.success) {
    const errors = issuesToErrors(r.error.issues);
    // Los errores de metadatos de la relación se muestran en el mismo campo del formulario.
    return { ok: false, errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/^metadata\./, ""), v])) };
  }
  return { ok: true, value: r.data };
}
