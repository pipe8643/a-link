import { ENTITY_CATALOG, ENTITY_TYPE_IDS, type EntityTypeId } from "./entity-catalog.js";
import { GRAPH_LIMITS, edgeInputSchema, nodeInputSchema, type GraphSnapshot } from "./graph-model.js";
import {
  EDGE_DIRECTIONS,
  EVIDENCE_CLASSES,
  EVIDENCE_LABELS_ES,
  RELATIONSHIP_LABELS_ES,
  RELATIONSHIP_TYPES,
  type EdgeDirection,
  type EvidenceClass,
  type RelationshipType,
} from "./relationships.js";

/** Límites del fichero Excel (el modelo del grafo sigue siendo GRAPH_LIMITS). */
export const EXCEL_IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxIssues: 20,
} as const;

export const EXCEL_SHEETS = {
  entities: "Entidades",
  relations: "Relaciones",
  instructions: "Instrucciones",
} as const;

export interface ExcelIssue {
  sheet: string;
  /** Fila de Excel (1 = cabecera). 0 si el problema es del fichero entero. */
  row: number;
  field: string;
  message: string;
}

export interface ExcelTable {
  headers: string[];
  rows: string[][];
}

export type ExcelImportResult = { ok: true; value: GraphSnapshot } | { ok: false; errors: ExcelIssue[] };

/** Quita acentos y signos para comparar cabeceras y tipos escritos por una persona. */
export function foldHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const CORE_ALIASES: Record<"ref" | "tipo" | "nombre" | "descripcion" | "notas" | "etiquetas", readonly string[]> = {
  ref: ["ref", "id", "clave", "referencia"],
  tipo: ["tipo", "type"],
  nombre: ["nombre", "name", "etiqueta", "label"],
  descripcion: ["descripcion", "description"],
  notas: ["notas", "notes"],
  etiquetas: ["etiquetas", "tags"],
};

const REL_ALIASES: Record<
  "origen" | "destino" | "tipo" | "etiqueta" | "naturaleza" | "direccion" | "inicio" | "fin" | "fuente" | "confianza" | "descripcion",
  readonly string[]
> = {
  origen: ["origen", "from", "source", "fuenteentidad"],
  destino: ["destino", "to", "target"],
  tipo: ["tipo", "type"],
  etiqueta: ["etiqueta", "label", "nombre"],
  naturaleza: ["naturaleza", "evidencia", "evidence", "evidenceclass"],
  direccion: ["direccion", "direction"],
  inicio: ["inicio", "start", "startdate", "fechaInicio"],
  fin: ["fin", "end", "enddate", "fechaFin"],
  fuente: ["fuente", "source", "origenDato"],
  confianza: ["confianza", "confidence"],
  descripcion: ["descripcion", "description"],
};

function aliasIndex(aliases: Record<string, readonly string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, names] of Object.entries(aliases)) {
    for (const name of names) map.set(foldHeader(name), canonical);
  }
  return map;
}

const ENTITY_CORE = aliasIndex(CORE_ALIASES);
const RELATION_CORE = aliasIndex(REL_ALIASES);

const TYPE_BY_FOLD = new Map<string, EntityTypeId>();
for (const id of ENTITY_TYPE_IDS) {
  TYPE_BY_FOLD.set(foldHeader(id), id);
  TYPE_BY_FOLD.set(foldHeader(ENTITY_CATALOG[id].name), id);
}

const REL_BY_FOLD = new Map<string, RelationshipType>();
for (const id of RELATIONSHIP_TYPES) {
  REL_BY_FOLD.set(foldHeader(id), id);
  REL_BY_FOLD.set(foldHeader(RELATIONSHIP_LABELS_ES[id]), id);
}

const EVIDENCE_BY_FOLD = new Map<string, EvidenceClass>([
  ...EVIDENCE_CLASSES.map((id) => [foldHeader(id), id] as const),
  ...EVIDENCE_CLASSES.map((id) => [foldHeader(EVIDENCE_LABELS_ES[id]), id] as const),
  ["registrado", "recorded"],
  ["hecho", "recorded"],
  ["hipotesis", "hypothesis"],
  ["observacion", "observation"],
]);

const DIRECTION_BY_FOLD = new Map<string, EdgeDirection>([
  ...EDGE_DIRECTIONS.map((id) => [foldHeader(id), id] as const),
  ["origendestino", "forward"],
  ["delorigenaldestino", "forward"],
  ["adelante", "forward"],
  ["sindireccion", "none"],
  ["ninguna", "none"],
  ["ambos", "both"],
  ["ambosentidos", "both"],
  ["bidireccional", "both"],
]);

/** Cabecera de metadatos: clave del campo o su etiqueta en español → `field.key`. */
function metadataKeyByFold(): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of Object.values(ENTITY_CATALOG)) {
    for (const field of def.fields) {
      map.set(foldHeader(field.key), field.key);
      map.set(foldHeader(field.label), field.key);
    }
  }
  return map;
}

const META_BY_FOLD = metadataKeyByFold();

function colOf(headers: string[], lookup: Map<string, string>, canonical: string): number {
  return headers.findIndex((_, i) => lookup.get(foldHeader(headers[i] ?? "")) === canonical);
}

function cell(row: string[], index: number): string {
  return (index < 0 ? "" : (row[index] ?? "")).trim();
}

function parseTags(raw: string): string[] {
  if (raw === "") return [];
  const parts = raw
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

function resolveSelect(type: EntityTypeId, key: string, raw: string): string {
  const field = ENTITY_CATALOG[type].fields.find((f) => f.key === key);
  if (!field?.options) return raw;
  const folded = foldHeader(raw);
  const hit = field.options.find((o) => foldHeader(o.value) === folded || foldHeader(o.label) === folded);
  return hit?.value ?? raw;
}

function issue(sheet: string, row: number, field: string, message: string): ExcelIssue {
  return { sheet, row, field, message };
}

/**
 * Convierte las hojas Entidades y Relaciones en un documento de grafo.
 * Cada `ref` se traduce a un UUID nuevo; las relaciones apuntan a esas refs.
 */
export function graphFromExcelTables(
  entities: ExcelTable,
  relations: ExcelTable,
  occupied: { nodes: number; edges: number } = { nodes: 0, edges: 0 },
): ExcelImportResult {
  const errors: ExcelIssue[] = [];
  const push = (e: ExcelIssue) => {
    if (errors.length < EXCEL_IMPORT_LIMITS.maxIssues) errors.push(e);
  };

  const refCol = colOf(entities.headers, ENTITY_CORE, "ref");
  const tipoCol = colOf(entities.headers, ENTITY_CORE, "tipo");
  const nombreCol = colOf(entities.headers, ENTITY_CORE, "nombre");
  if (refCol < 0) push(issue(EXCEL_SHEETS.entities, 1, "ref", "Falta la columna «ref»."));
  if (tipoCol < 0) push(issue(EXCEL_SHEETS.entities, 1, "tipo", "Falta la columna «tipo»."));
  if (nombreCol < 0) push(issue(EXCEL_SHEETS.entities, 1, "nombre", "Falta la columna «nombre»."));

  const descCol = colOf(entities.headers, ENTITY_CORE, "descripcion");
  const notasCol = colOf(entities.headers, ENTITY_CORE, "notas");
  const tagsCol = colOf(entities.headers, ENTITY_CORE, "etiquetas");

  const metaCols: Array<{ index: number; key: string; header: string }> = [];
  const seenMeta = new Set<string>();
  for (let i = 0; i < entities.headers.length; i++) {
    const header = entities.headers[i] ?? "";
    if (header.trim() === "") continue;
    const folded = foldHeader(header);
    if (ENTITY_CORE.has(folded)) continue;
    const key = META_BY_FOLD.get(folded);
    if (!key) {
      const used = entities.rows.some((r) => cell(r, i) !== "");
      if (used) push(issue(EXCEL_SHEETS.entities, 1, header, "Columna no reconocida."));
      continue;
    }
    if (seenMeta.has(key)) continue;
    seenMeta.add(key);
    metaCols.push({ index: i, key, header });
  }

  if (entities.rows.length > GRAPH_LIMITS.maxNodes) {
    push(issue(EXCEL_SHEETS.entities, 0, "filas", `Máximo ${GRAPH_LIMITS.maxNodes} entidades.`));
  }
  if (occupied.nodes + entities.rows.length > GRAPH_LIMITS.maxNodes) {
    push(issue(EXCEL_SHEETS.entities, 0, "filas", `El grafo no admite más entidades (máximo ${GRAPH_LIMITS.maxNodes}).`));
  }

  const refs = new Map<string, string>();
  const seenRefs = new Set<string>();
  const nodes: GraphSnapshot["nodes"] = [];

  entities.rows.forEach((row, i) => {
    const excelRow = i + 2;
    const ref = cell(row, refCol);
    const tipoRaw = cell(row, tipoCol);
    const nombre = cell(row, nombreCol);
    if (ref === "" && tipoRaw === "" && nombre === "") return;
    if (ref === "") {
      push(issue(EXCEL_SHEETS.entities, excelRow, "ref", "La referencia es obligatoria."));
      return;
    }
    const refKey = foldHeader(ref);
    if (seenRefs.has(refKey)) {
      push(issue(EXCEL_SHEETS.entities, excelRow, "ref", "Referencia duplicada."));
      return;
    }
    seenRefs.add(refKey);
    const type = TYPE_BY_FOLD.get(foldHeader(tipoRaw));
    if (!type) {
      push(issue(EXCEL_SHEETS.entities, excelRow, "tipo", "Tipo de entidad no válido."));
      return;
    }
    const allowed = new Set(ENTITY_CATALOG[type].fields.map((f) => f.key));
    const metadata: Record<string, string> = {};
    for (const col of metaCols) {
      const value = cell(row, col.index);
      if (value === "") continue;
      if (!allowed.has(col.key)) {
        push(issue(EXCEL_SHEETS.entities, excelRow, col.header, `Este campo no aplica al tipo ${ENTITY_CATALOG[type].name}.`));
        continue;
      }
      metadata[col.key] = resolveSelect(type, col.key, value);
    }
    const parsed = nodeInputSchema.safeParse({
      id: crypto.randomUUID(),
      type,
      label: nombre,
      description: cell(row, descCol),
      notes: cell(row, notasCol),
      tags: parseTags(cell(row, tagsCol)),
      metadata,
      imageId: null,
      positionX: null,
      positionY: null,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path.map(String).join(".") || "nombre";
      push(issue(EXCEL_SHEETS.entities, excelRow, field, first?.message ?? "Fila no válida."));
      return;
    }
    refs.set(refKey, parsed.data.id);
    nodes.push(parsed.data);
  });

  const origenCol = colOf(relations.headers, RELATION_CORE, "origen");
  const destinoCol = colOf(relations.headers, RELATION_CORE, "destino");
  const relTipoCol = colOf(relations.headers, RELATION_CORE, "tipo");
  if (relations.headers.length > 0) {
    if (origenCol < 0) push(issue(EXCEL_SHEETS.relations, 1, "origen", "Falta la columna «origen»."));
    if (destinoCol < 0) push(issue(EXCEL_SHEETS.relations, 1, "destino", "Falta la columna «destino»."));
    if (relTipoCol < 0) push(issue(EXCEL_SHEETS.relations, 1, "tipo", "Falta la columna «tipo»."));
  }
  const etiquetaCol = colOf(relations.headers, RELATION_CORE, "etiqueta");
  const natCol = colOf(relations.headers, RELATION_CORE, "naturaleza");
  const dirCol = colOf(relations.headers, RELATION_CORE, "direccion");
  const inicioCol = colOf(relations.headers, RELATION_CORE, "inicio");
  const finCol = colOf(relations.headers, RELATION_CORE, "fin");
  const fuenteCol = colOf(relations.headers, RELATION_CORE, "fuente");
  const confCol = colOf(relations.headers, RELATION_CORE, "confianza");
  const relDescCol = colOf(relations.headers, RELATION_CORE, "descripcion");

  if (relations.rows.length > GRAPH_LIMITS.maxEdges) {
    push(issue(EXCEL_SHEETS.relations, 0, "filas", `Máximo ${GRAPH_LIMITS.maxEdges} relaciones.`));
  }
  if (occupied.edges + relations.rows.length > GRAPH_LIMITS.maxEdges) {
    push(issue(EXCEL_SHEETS.relations, 0, "filas", `El grafo no admite más relaciones (máximo ${GRAPH_LIMITS.maxEdges}).`));
  }

  const edges: GraphSnapshot["edges"] = [];
  relations.rows.forEach((row, i) => {
    const excelRow = i + 2;
    const origen = cell(row, origenCol);
    const destino = cell(row, destinoCol);
    const tipoRaw = cell(row, relTipoCol);
    if (origen === "" && destino === "" && tipoRaw === "") return;
    const sourceId = refs.get(foldHeader(origen));
    const targetId = refs.get(foldHeader(destino));
    if (!sourceId) {
      push(issue(EXCEL_SHEETS.relations, excelRow, "origen", "No hay una entidad con esa ref."));
      return;
    }
    if (!targetId) {
      push(issue(EXCEL_SHEETS.relations, excelRow, "destino", "No hay una entidad con esa ref."));
      return;
    }
    const relationshipType = REL_BY_FOLD.get(foldHeader(tipoRaw));
    if (!relationshipType) {
      push(issue(EXCEL_SHEETS.relations, excelRow, "tipo", "Tipo de relación no válido."));
      return;
    }
    const evidenceRaw = cell(row, natCol);
    const directionRaw = cell(row, dirCol);
    const confRaw = cell(row, confCol);
    let confidence: number | undefined;
    if (confRaw !== "") {
      const n = Number(confRaw);
      if (!Number.isInteger(n)) {
        push(issue(EXCEL_SHEETS.relations, excelRow, "confianza", "La confianza debe ser un entero de 0 a 100."));
        return;
      }
      confidence = n;
    }
    const metadata: Record<string, unknown> = {
      direction: directionRaw === "" ? "forward" : (DIRECTION_BY_FOLD.get(foldHeader(directionRaw)) ?? directionRaw),
      evidenceClass: evidenceRaw === "" ? "hypothesis" : (EVIDENCE_BY_FOLD.get(foldHeader(evidenceRaw)) ?? evidenceRaw),
    };
    const description = cell(row, relDescCol);
    const startDate = cell(row, inicioCol);
    const endDate = cell(row, finCol);
    const source = cell(row, fuenteCol);
    if (description) metadata.description = description;
    if (startDate) metadata.startDate = startDate;
    if (endDate) metadata.endDate = endDate;
    if (source) metadata.source = source;
    if (confidence !== undefined) metadata.confidence = confidence;

    const parsed = edgeInputSchema.safeParse({
      id: crypto.randomUUID(),
      sourceId,
      targetId,
      relationshipType,
      label: cell(row, etiquetaCol),
      metadata,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path.map(String).join(".") || "tipo";
      push(issue(EXCEL_SHEETS.relations, excelRow, field, first?.message ?? "Fila no válida."));
      return;
    }
    edges.push(parsed.data);
  });

  if (nodes.length === 0 && errors.length === 0) {
    push(issue(EXCEL_SHEETS.entities, 0, "filas", "No hay entidades que importar."));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { nodes, edges } };
}

const ENTITY_CORE_HEADERS = ["ref", "tipo", "nombre", "descripcion", "notas", "etiquetas"] as const;

/** Claves de metadatos (únicas) para la plantilla, en orden de aparición en el catálogo. */
export function excelMetadataHeaders(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const def of Object.values(ENTITY_CATALOG)) {
    for (const field of def.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      keys.push(field.key);
    }
  }
  return keys;
}

export const EXCEL_ENTITY_HEADERS = [...ENTITY_CORE_HEADERS, ...excelMetadataHeaders()];
export const EXCEL_RELATION_HEADERS = [
  "origen",
  "destino",
  "tipo",
  "etiqueta",
  "naturaleza",
  "direccion",
  "inicio",
  "fin",
  "fuente",
  "confianza",
  "descripcion",
] as const;

function entityExample(ref: string, tipo: string, nombre: string, extra: Record<string, string>): string[] {
  const row = EXCEL_ENTITY_HEADERS.map((h) => {
    if (h === "ref") return ref;
    if (h === "tipo") return tipo;
    if (h === "nombre") return nombre;
    return extra[h] ?? "";
  });
  return row;
}

/** Filas de ejemplo (cabecera incluida) para generar la plantilla .xlsx. */
export function excelTemplateTables(): { entities: ExcelTable; relations: ExcelTable; instructions: string[][] } {
  const entities: ExcelTable = {
    headers: [...EXCEL_ENTITY_HEADERS],
    rows: [
      entityExample("ana", "Persona", "Ana Pérez", { fullName: "Ana Pérez", alias: "AP", etiquetas: "caso" }),
      entityExample("tel1", "Teléfono", "+34 600 000 000", { number: "+34 600 000 000", country: "ES", lineType: "mobile" }),
      entityExample("acme", "Organización o empresa", "Acme SL", { legalName: "Acme SL", sector: "Servicios" }),
    ],
  };
  const relations: ExcelTable = {
    headers: [...EXCEL_RELATION_HEADERS],
    rows: [
      ["ana", "tel1", "Contacto", "", "Hipótesis", "origen→destino", "", "", "", "", ""],
      ["ana", "acme", "Relación comercial", "socia", "Observación", "ambos", "2024-01-15", "", "registro mercantil", "70", ""],
    ],
  };
  const typeLines = ENTITY_TYPE_IDS.map((id) => `${ENTITY_CATALOG[id].name}  |  ${id}`);
  const relLines = RELATIONSHIP_TYPES.map((id) => `${RELATIONSHIP_LABELS_ES[id]}  |  ${id}`);
  const fieldLines = Object.values(ENTITY_CATALOG).flatMap((def) =>
    def.fields.map((f) => {
      const opts = f.options?.map((o) => `${o.label} (${o.value})`).join(", ");
      return `${def.name}: ${f.key} — ${f.label}${opts ? ` [${opts}]` : ""}`;
    }),
  );
  const instructions: string[][] = [
    ["Importar un grafo en A-Link"],
    [""],
    ["1. Rellena la hoja Entidades (una fila por nodo) y la hoja Relaciones (una fila por arista)."],
    ["2. «ref» es una clave tuya (ana, tel1…). Las relaciones usan esas refs en origen y destino."],
    ["3. «tipo» admite el nombre en español o el identificador interno."],
    ["4. Las columnas de metadatos (fullName, number, plate…) son opcionales y solo aplican a su tipo."],
    ["5. Guarda el fichero como .xlsx (Excel 2007 o posterior). No uses fórmulas."],
    ["6. En el editor: Importar Excel. El lienzo se reorganiza solo."],
    [""],
    ["Tipos de entidad (nombre | identificador)"],
    ...typeLines.map((l) => [l]),
    [""],
    ["Tipos de relación (nombre | identificador)"],
    ...relLines.map((l) => [l]),
    [""],
    ["Naturaleza: Hipótesis | Dato registrado | Observación"],
    ["Dirección: origen→destino | sin dirección | ambos"],
    ["Fechas: AAAA-MM-DD. Confianza: 0 a 100. Etiquetas: separadas por coma."],
    [""],
    ["Campos de metadatos por tipo (columna = clave)"],
    ...fieldLines.map((l) => [l]),
  ];
  return { entities, relations, instructions };
}
