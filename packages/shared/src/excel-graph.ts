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
  graph: "Grafo",
  lists: "Listas",
} as const;

/** Columnas de la plantilla (una sola hoja). Los desplegables cubren tipo, tipo_enlace, naturaleza y direccion. */
export const EXCEL_GRAPH_HEADERS = [
  "ref",
  "tipo",
  "nombre",
  "descripcion",
  "etiquetas",
  "enlace_con",
  "tipo_enlace",
  "etiqueta_enlace",
  "naturaleza",
  "direccion",
] as const;

export const EXCEL_HELP_TEXT =
  "Cómo rellenar: 1) En cada fila, una entidad: ref corta (ana, tel1), tipo (lista) y nombre. 2) Para unirla a otra, escribe esa ref en enlace_con y elige el tipo de enlace. 3) Si tiene varios enlaces, copia la ref en la fila de abajo y cambia solo el enlace. No borres esta fila ni la de cabeceras.";

export const EXCEL_DROPDOWN_PROMPTS = {
  tipo: "Elige el tipo de entidad.",
  tipo_enlace: "Elige cómo se relacionan.",
  naturaleza: "Hipótesis, dato registrado u observación.",
  direccion: "Hacia el enlace, sin flecha, o en ambos sentidos.",
} as const;

export interface ExcelIssue {
  sheet: string;
  /** Fila de Excel (1 = primera fila del fichero). 0 si el problema es del fichero entero. */
  row: number;
  field: string;
  message: string;
}

export interface ExcelTable {
  headers: string[];
  rows: string[][];
  /** Fila de Excel (1 = primera) donde está la cabecera. Por defecto 1. */
  headerRow?: number;
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

const COL_ALIASES: Record<(typeof EXCEL_GRAPH_HEADERS)[number], readonly string[]> = {
  ref: ["ref", "id", "clave", "referencia"],
  tipo: ["tipo", "type"],
  nombre: ["nombre", "name", "label"],
  descripcion: ["descripcion", "description", "notas", "notes"],
  etiquetas: ["etiquetas", "tags"],
  enlace_con: ["enlacecon", "relacionadocon", "destino", "con", "hacia"],
  tipo_enlace: ["tipoenlace", "tiporelacion", "relacion"],
  etiqueta_enlace: ["etiquetaenlace", "etiqueta", "rotulo"],
  naturaleza: ["naturaleza", "evidencia", "evidence", "evidenceclass"],
  direccion: ["direccion", "direction"],
};

function aliasIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, names] of Object.entries(COL_ALIASES)) {
    map.set(foldHeader(canonical), canonical);
    for (const name of names) map.set(foldHeader(name), canonical);
  }
  return map;
}

const COL_BY_FOLD = aliasIndex();

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

export const EXCEL_ENTITY_TYPE_LABELS = ENTITY_TYPE_IDS.map((id) => ENTITY_CATALOG[id].name);
export const EXCEL_RELATION_TYPE_LABELS = RELATIONSHIP_TYPES.map((id) => RELATIONSHIP_LABELS_ES[id]);
export const EXCEL_EVIDENCE_LABELS = EVIDENCE_CLASSES.map((id) => EVIDENCE_LABELS_ES[id]);
export const EXCEL_DIRECTION_LABELS = ["origen→destino", "sin dirección", "ambos"] as const;

function colOf(headers: string[], canonical: string): number {
  return headers.findIndex((_, i) => COL_BY_FOLD.get(foldHeader(headers[i] ?? "")) === canonical);
}

function cell(row: string[], index: number): string {
  return (index < 0 ? "" : (row[index] ?? "")).trim();
}

function parseTags(raw: string): string[] {
  if (raw === "") return [];
  return [...new Set(raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean))];
}

function issue(row: number, field: string, message: string): ExcelIssue {
  return { sheet: EXCEL_SHEETS.graph, row, field, message };
}

/**
 * Una sola hoja: cada fila declara (o reutiliza) una entidad y, si «enlace_con» tiene valor, un enlace.
 * La misma `ref` en varias filas añade más enlaces sin duplicar el nodo.
 */
export function graphFromExcelSheet(table: ExcelTable, occupied: { nodes: number; edges: number } = { nodes: 0, edges: 0 }): ExcelImportResult {
  const errors: ExcelIssue[] = [];
  const push = (e: ExcelIssue) => {
    if (errors.length < EXCEL_IMPORT_LIMITS.maxIssues) errors.push(e);
  };

  const headerRow = table.headerRow ?? 1;
  const refCol = colOf(table.headers, "ref");
  const tipoCol = colOf(table.headers, "tipo");
  const nombreCol = colOf(table.headers, "nombre");
  if (refCol < 0) push(issue(headerRow, "ref", "Falta la columna «ref»."));
  if (tipoCol < 0) push(issue(headerRow, "tipo", "Falta la columna «tipo»."));
  if (nombreCol < 0) push(issue(headerRow, "nombre", "Falta la columna «nombre»."));

  const descCol = colOf(table.headers, "descripcion");
  const tagsCol = colOf(table.headers, "etiquetas");
  const linkCol = colOf(table.headers, "enlace_con");
  const linkTypeCol = colOf(table.headers, "tipo_enlace");
  const linkLabelCol = colOf(table.headers, "etiqueta_enlace");
  const natCol = colOf(table.headers, "naturaleza");
  const dirCol = colOf(table.headers, "direccion");

  type Pending = { excelRow: number; tipo: string; nombre: string; descripcion: string; etiquetas: string };
  const firstRow = new Map<string, Pending>();
  const order: string[] = [];
  const links: Array<{ excelRow: number; from: string; to: string; tipo: string; etiqueta: string; naturaleza: string; direccion: string }> = [];

  let prevRef = "";
  table.rows.forEach((row, i) => {
    const excelRow = headerRow + 1 + i;
    let ref = cell(row, refCol);
    const tipoRaw = cell(row, tipoCol);
    const nombre = cell(row, nombreCol);
    const enlace = cell(row, linkCol);
    const tipoEnlace = cell(row, linkTypeCol);
    if (ref === "" && tipoRaw === "" && nombre === "" && enlace === "" && tipoEnlace === "") return;
    if (ref === "") ref = prevRef;
    if (ref === "") {
      push(issue(excelRow, "ref", "Indica una ref (por ejemplo ana)."));
      return;
    }
    prevRef = ref;
    const refKey = foldHeader(ref);
    const existing = firstRow.get(refKey);
    if (!existing) {
      firstRow.set(refKey, {
        excelRow,
        tipo: tipoRaw,
        nombre: nombre || ref,
        descripcion: cell(row, descCol),
        etiquetas: cell(row, tagsCol),
      });
      order.push(refKey);
    } else if (tipoRaw && foldHeader(tipoRaw) !== foldHeader(existing.tipo)) {
      push(issue(excelRow, "tipo", "Esta ref ya tiene otro tipo. Déjalo vacío si solo añades un enlace."));
    } else if (nombre && nombre !== existing.nombre) {
      push(issue(excelRow, "nombre", "Esta ref ya tiene otro nombre. Déjalo vacío si solo añades un enlace."));
    }
    if (enlace === "" && tipoEnlace === "") return;
    if (enlace === "") {
      push(issue(excelRow, "enlace_con", "Indica la ref de la otra entidad."));
      return;
    }
    if (tipoEnlace === "") {
      push(issue(excelRow, "tipo_enlace", "Elige el tipo de enlace."));
      return;
    }
    links.push({
      excelRow,
      from: refKey,
      to: foldHeader(enlace),
      tipo: tipoEnlace,
      etiqueta: cell(row, linkLabelCol),
      naturaleza: cell(row, natCol),
      direccion: cell(row, dirCol),
    });
  });

  if (order.length > GRAPH_LIMITS.maxNodes || occupied.nodes + order.length > GRAPH_LIMITS.maxNodes) {
    push(issue(0, "filas", `El grafo no admite más entidades (máximo ${GRAPH_LIMITS.maxNodes}).`));
  }
  if (links.length > GRAPH_LIMITS.maxEdges || occupied.edges + links.length > GRAPH_LIMITS.maxEdges) {
    push(issue(0, "filas", `El grafo no admite más relaciones (máximo ${GRAPH_LIMITS.maxEdges}).`));
  }

  const refs = new Map<string, string>();
  const nodes: GraphSnapshot["nodes"] = [];
  for (const refKey of order) {
    const row = firstRow.get(refKey)!;
    const type = TYPE_BY_FOLD.get(foldHeader(row.tipo));
    if (!type) {
      push(issue(row.excelRow, "tipo", "Elige un tipo de la lista (Persona, Teléfono…)."));
      continue;
    }
    const parsed = nodeInputSchema.safeParse({
      id: crypto.randomUUID(),
      type,
      label: row.nombre,
      description: row.descripcion,
      notes: "",
      tags: parseTags(row.etiquetas),
      metadata: {},
      imageId: null,
      positionX: null,
      positionY: null,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      push(issue(row.excelRow, first?.path.map(String).join(".") || "nombre", first?.message ?? "Fila no válida."));
      continue;
    }
    refs.set(refKey, parsed.data.id);
    nodes.push(parsed.data);
  }

  const edges: GraphSnapshot["edges"] = [];
  for (const link of links) {
    const sourceId = refs.get(link.from);
    const targetId = refs.get(link.to);
    if (!sourceId) continue;
    if (!targetId) {
      push(issue(link.excelRow, "enlace_con", "No hay ninguna fila con esa ref. Créala en «ref» antes de enlazarla."));
      continue;
    }
    if (sourceId === targetId) {
      push(issue(link.excelRow, "enlace_con", "Un enlace debe unir dos entidades distintas."));
      continue;
    }
    const relationshipType = REL_BY_FOLD.get(foldHeader(link.tipo));
    if (!relationshipType) {
      push(issue(link.excelRow, "tipo_enlace", "Elige un tipo de enlace de la lista."));
      continue;
    }
    const parsed = edgeInputSchema.safeParse({
      id: crypto.randomUUID(),
      sourceId,
      targetId,
      relationshipType,
      label: link.etiqueta,
      metadata: {
        direction: link.direccion === "" ? "forward" : (DIRECTION_BY_FOLD.get(foldHeader(link.direccion)) ?? link.direccion),
        evidenceClass: link.naturaleza === "" ? "hypothesis" : (EVIDENCE_BY_FOLD.get(foldHeader(link.naturaleza)) ?? link.naturaleza),
      },
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      push(issue(link.excelRow, first?.path.map(String).join(".") || "tipo_enlace", first?.message ?? "Enlace no válido."));
      continue;
    }
    edges.push(parsed.data);
  }

  if (nodes.length === 0 && errors.length === 0) push(issue(0, "filas", "No hay entidades que importar."));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { nodes, edges } };
}

function graphRow(values: Partial<Record<(typeof EXCEL_GRAPH_HEADERS)[number], string>>): string[] {
  return EXCEL_GRAPH_HEADERS.map((h) => values[h] ?? "");
}

/** Filas de ejemplo de la plantilla (cabecera no incluida). */
export function excelTemplateSheet(): { help: string; headers: string[]; rows: string[][]; lists: { entityTypes: string[]; relationTypes: string[]; evidence: string[]; directions: string[] } } {
  return {
    help: EXCEL_HELP_TEXT,
    headers: [...EXCEL_GRAPH_HEADERS],
    rows: [
      graphRow({
        ref: "ana",
        tipo: "Persona",
        nombre: "Ana Pérez",
        etiquetas: "caso",
        enlace_con: "tel1",
        tipo_enlace: "Contacto",
        naturaleza: "Hipótesis",
        direccion: "origen→destino",
      }),
      graphRow({
        ref: "ana",
        enlace_con: "acme",
        tipo_enlace: "Relación comercial",
        etiqueta_enlace: "socia",
        naturaleza: "Observación",
        direccion: "ambos",
      }),
      graphRow({ ref: "tel1", tipo: "Teléfono", nombre: "+34 600 000 000" }),
      graphRow({ ref: "acme", tipo: "Organización o empresa", nombre: "Acme SL" }),
    ],
    lists: {
      entityTypes: [...EXCEL_ENTITY_TYPE_LABELS],
      relationTypes: [...EXCEL_RELATION_TYPE_LABELS],
      evidence: [...EXCEL_EVIDENCE_LABELS],
      directions: [...EXCEL_DIRECTION_LABELS],
    },
  };
}
