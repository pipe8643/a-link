import type { EntityTypeId, EvidenceClass, GraphEdgeData, GraphSnapshot } from "@a-link/shared";

/**
 * VISTA del grafo: qué parte del documento se muestra en el lienzo. Es solo presentación: ni el documento ni lo
 * que se guarda cambian (el autoguardado y el historial trabajan siempre con el grafo completo).
 *
 * Dos mecanismos que se combinan:
 *  - **Filtros** (tipos de entidad, naturaleza del dato, fechas de las relaciones).
 *  - **Enfoque**: se parte de una o varias entidades «raíz» y se ven ellas y sus vecinos directos; cada vecino se
 *    puede **expandir** (se suman sus vecinos) o **contraer**. Es la forma de recorrer grafos grandes sin ver todo
 *    a la vez.
 */
export interface ViewState {
  hiddenTypes: readonly EntityTypeId[];
  hiddenEvidence: readonly EvidenceClass[];
  /** AAAA-MM-DD; cadena vacía = sin límite. */
  dateFrom: string;
  dateTo: string;
  /** Con un rango de fechas activo: ¿se muestran las relaciones que no tienen ninguna fecha? */
  includeUndated: boolean;
  focus: { roots: readonly string[]; expanded: readonly string[] } | null;
}

export const EMPTY_VIEW: ViewState = {
  hiddenTypes: [],
  hiddenEvidence: [],
  dateFrom: "",
  dateTo: "",
  includeUndated: true,
  focus: null,
};

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hasFilters(view: ViewState): boolean {
  return view.hiddenTypes.length > 0 || view.hiddenEvidence.length > 0 || view.dateFrom !== "" || view.dateTo !== "";
}

export interface Pinned {
  nodeIds?: readonly string[];
  edgeIds?: readonly string[];
}

export interface ViewResult {
  /** Lo que ve el lienzo. Es el MISMO objeto que el documento cuando no hay nada filtrado. */
  doc: GraphSnapshot;
  filtered: boolean;
  focusActive: boolean;
  hiddenNodes: number;
  hiddenEdges: number;
  visibleNodeIds: ReadonlySet<string>;
  /** Entidades raíz del enfoque que siguen existiendo. */
  roots: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
}

/** ¿La relación pasa los filtros que dependen de ella (naturaleza del dato y fechas)? */
export function edgeAllowed(edge: GraphEdgeData, view: ViewState): boolean {
  if (view.hiddenEvidence.includes(edge.metadata.evidenceClass ?? "hypothesis")) return false;
  if (view.dateFrom === "" && view.dateTo === "") return true;
  const start = edge.metadata.startDate;
  const end = edge.metadata.endDate;
  if (!start && !end) return view.includeUndated;
  // Solo inicio = desde esa fecha sin fin conocido; solo fin = hasta esa fecha. Se muestra si el intervalo toca el rango.
  const lo = start ?? "0000-01-01";
  const hi = end ?? "9999-12-31";
  if (view.dateFrom !== "" && hi < view.dateFrom) return false;
  if (view.dateTo !== "" && lo > view.dateTo) return false;
  return true;
}

function adjacency(doc: GraphSnapshot, view: ViewState): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (const e of doc.edges) {
    if (!edgeAllowed(e, view)) continue;
    link(e.sourceId, e.targetId);
    link(e.targetId, e.sourceId);
  }
  return adj;
}

/**
 * Calcula la vista. `pinned` son los elementos que SIEMPRE se ven (la selección actual): así lo seleccionado desde
 * una lista no desaparece del lienzo por un filtro.
 */
export function computeView(doc: GraphSnapshot, view: ViewState, pinned: Pinned = {}): ViewResult {
  const existing = new Set(doc.nodes.map((n) => n.id));
  const roots = new Set((view.focus?.roots ?? []).filter((id) => existing.has(id)));
  const expanded = new Set((view.focus?.expanded ?? []).filter((id) => existing.has(id)));
  const focusActive = roots.size > 0; // un enfoque sin raíces válidas (borradas) se ignora
  const filtered = hasFilters(view) || focusActive;

  if (!filtered) {
    return { doc, filtered: false, focusActive: false, hiddenNodes: 0, hiddenEdges: 0, visibleNodeIds: existing, roots, expanded };
  }

  let inFocus: Set<string> | null = null;
  if (focusActive) {
    const adj = adjacency(doc, view);
    inFocus = new Set<string>();
    for (const id of [...roots, ...expanded]) {
      inFocus.add(id);
      for (const n of adj.get(id) ?? []) inFocus.add(n);
    }
  }

  const pinnedNodes = new Set(pinned.nodeIds ?? []);
  const pinnedEdges = new Set(pinned.edgeIds ?? []);
  for (const e of doc.edges) {
    if (pinnedEdges.has(e.id)) {
      pinnedNodes.add(e.sourceId);
      pinnedNodes.add(e.targetId);
    }
  }

  const hiddenTypes = new Set(view.hiddenTypes);
  const nodes = doc.nodes.filter((n) => pinnedNodes.has(n.id) || (!hiddenTypes.has(n.type) && (inFocus === null || inFocus.has(n.id))));
  const visibleNodeIds = new Set(nodes.map((n) => n.id));
  const edges = doc.edges.filter((e) => visibleNodeIds.has(e.sourceId) && visibleNodeIds.has(e.targetId) && (pinnedEdges.has(e.id) || edgeAllowed(e, view)));

  return {
    doc: { nodes, edges },
    filtered: true,
    focusActive,
    hiddenNodes: doc.nodes.length - nodes.length,
    hiddenEdges: doc.edges.length - edges.length,
    visibleNodeIds,
    roots,
    expanded,
  };
}

/** Vecinos directos de una entidad (por relaciones que pasan los filtros) que ahora mismo NO se ven. */
export function hiddenNeighbors(doc: GraphSnapshot, view: ViewState, result: ViewResult, id: string): string[] {
  const out = new Set<string>();
  for (const e of doc.edges) {
    if (!edgeAllowed(e, view)) continue;
    const other = e.sourceId === id ? e.targetId : e.targetId === id ? e.sourceId : null;
    if (other && !result.visibleNodeIds.has(other)) out.add(other);
  }
  return [...out];
}

/** Entidades que se ven por ser vecinas de `id` (para contraer). */
export function visibleNeighbors(doc: GraphSnapshot, view: ViewState, id: string): string[] {
  const out = new Set<string>();
  for (const e of doc.edges) {
    if (!edgeAllowed(e, view)) continue;
    if (e.sourceId === id) out.add(e.targetId);
    else if (e.targetId === id) out.add(e.sourceId);
  }
  return [...out];
}

// --- Transiciones del enfoque (puras) -------------------------------------------------------------------------

const uniq = (ids: readonly string[]) => [...new Set(ids)];

/** Enfoca en estas entidades (sustituye cualquier enfoque anterior). */
export function focusOn(view: ViewState, ids: readonly string[]): ViewState {
  const roots = uniq(ids);
  return roots.length === 0 ? { ...view, focus: null } : { ...view, focus: { roots, expanded: [] } };
}

/** Suma los vecinos de `id` a lo que se ve. Sin enfoque previo, `id` pasa a ser la raíz. */
export function expandNode(view: ViewState, id: string): ViewState {
  if (!view.focus) return focusOn(view, [id]);
  if (view.focus.roots.includes(id) || view.focus.expanded.includes(id)) return view;
  return { ...view, focus: { roots: view.focus.roots, expanded: [...view.focus.expanded, id] } };
}

/**
 * Quita lo que se abrió desde `id`. Una raíz no se puede contraer del todo (siempre se ven ella y sus vecinos);
 * para dejar de enfocar se usa «Mostrar todo».
 */
export function collapseNode(view: ViewState, id: string): ViewState {
  if (!view.focus || !view.focus.expanded.includes(id)) return view;
  return { ...view, focus: { roots: view.focus.roots, expanded: view.focus.expanded.filter((x) => x !== id) } };
}

/** Añade una entidad recién creada al enfoque (si no, desaparecería al deseleccionarla). */
export function addToFocus(view: ViewState, id: string): ViewState {
  if (!view.focus) return view;
  if (view.focus.roots.includes(id)) return view;
  return { ...view, focus: { roots: [...view.focus.roots, id], expanded: view.focus.expanded } };
}

export const clearFocus = (view: ViewState): ViewState => (view.focus ? { ...view, focus: null } : view);

export type ExploreAction = "focused" | "expanded" | "collapsed" | "showall" | null;

/**
 * Exploración al estilo de las demos de ZoomCharts: doble clic en un nodo principal retrae el grafo a él y
 * sus vecinos; en un vecino con más conexiones, las extiende; otro clic las contrae; en la raíz, vuelve a
 * verse todo. No cambia el documento, solo la vista.
 */
export function toggleExplore(view: ViewState, result: ViewResult, doc: GraphSnapshot, id: string): { view: ViewState; action: ExploreAction } {
  if (!result.visibleNodeIds.has(id) && !doc.nodes.some((n) => n.id === id)) return { view, action: null };
  if (!result.focusActive) return { view: focusOn(view, [id]), action: "focused" };
  if (hiddenNeighbors(doc, view, result, id).length > 0) return { view: expandNode(view, id), action: "expanded" };
  if (view.focus?.expanded.includes(id)) return { view: collapseNode(view, id), action: "collapsed" };
  if (view.focus?.roots.includes(id)) {
    if (view.focus.expanded.length > 0) return { view: { ...view, focus: { roots: view.focus.roots, expanded: [] } }, action: "collapsed" };
    return { view: { ...view, focus: null }, action: "showall" };
  }
  return { view, action: null };
}

export function toggleInList<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
