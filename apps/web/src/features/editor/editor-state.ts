import { GRAPH_LIMITS, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";

/**
 * Estado del documento del editor: reductor PURO (sin React, sin ZoomCharts), por eso es fácil de
 * probar. ZoomCharts es solo presentación; la fuente de verdad del contenido es este documento.
 *
 * Invariantes que el reductor garantiza aunque la interfaz falle (defensa en profundidad):
 *  - ids únicos; una arista solo existe si sus dos extremos existen y son distintos;
 *  - borrar una entidad borra sus relaciones;
 *  - límites de tamaño del modelo compartido.
 */
export const HISTORY_LIMIT = 100;

export interface EditorState {
  doc: GraphSnapshot;
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  /** Sube en cada cambio del documento (base del autoguardado en la Fase 5). */
  version: number;
}

export type EditorAction =
  | { type: "load"; doc: GraphSnapshot }
  | { type: "addNode"; node: GraphNodeData }
  | { type: "updateNode"; node: GraphNodeData }
  | { type: "moveNodes"; positions: Array<{ id: string; x: number; y: number }> }
  | { type: "removeNodes"; ids: readonly string[] }
  | { type: "addEdge"; edge: GraphEdgeData }
  | { type: "updateEdge"; edge: GraphEdgeData }
  | { type: "removeEdges"; ids: readonly string[] }
  | { type: "importDoc"; nodes: GraphNodeData[]; edges: GraphEdgeData[] }
  | { type: "undo" }
  | { type: "redo" };

export const EMPTY_DOC: GraphSnapshot = { nodes: [], edges: [] };

export function initialState(doc: GraphSnapshot = EMPTY_DOC): EditorState {
  return { doc, past: [], future: [], version: 0 };
}

/** Aplica un cambio al documento registrando el historial. Un cambio sin efecto no ensucia nada. */
function commit(state: EditorState, doc: GraphSnapshot): EditorState {
  if (doc === state.doc) return state;
  return {
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
    version: state.version + 1,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { doc } = state;
  switch (action.type) {
    case "load":
      return initialState(action.doc);

    case "addNode": {
      if (doc.nodes.length >= GRAPH_LIMITS.maxNodes) return state;
      if (doc.nodes.some((n) => n.id === action.node.id)) return state;
      return commit(state, { ...doc, nodes: [...doc.nodes, action.node] });
    }

    case "updateNode": {
      if (!doc.nodes.some((n) => n.id === action.node.id)) return state;
      return commit(state, { ...doc, nodes: doc.nodes.map((n) => (n.id === action.node.id ? action.node : n)) });
    }

    case "moveNodes": {
      const byId = new Map(action.positions.map((p) => [p.id, p]));
      let changed = false;
      const nodes = doc.nodes.map((n) => {
        const p = byId.get(n.id);
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return n;
        if (n.positionX === p.x && n.positionY === p.y) return n;
        changed = true;
        return { ...n, positionX: p.x, positionY: p.y };
      });
      return changed ? commit(state, { ...doc, nodes }) : state;
    }

    case "removeNodes": {
      const ids = new Set(action.ids);
      if (!doc.nodes.some((n) => ids.has(n.id))) return state;
      return commit(state, {
        nodes: doc.nodes.filter((n) => !ids.has(n.id)),
        edges: doc.edges.filter((e) => !ids.has(e.sourceId) && !ids.has(e.targetId)),
      });
    }

    case "addEdge": {
      const { edge } = action;
      if (doc.edges.length >= GRAPH_LIMITS.maxEdges) return state;
      if (doc.edges.some((e) => e.id === edge.id)) return state;
      if (edge.sourceId === edge.targetId) return state;
      const ids = new Set(doc.nodes.map((n) => n.id));
      if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) return state;
      return commit(state, { ...doc, edges: [...doc.edges, edge] });
    }

    case "updateEdge": {
      const { edge } = action;
      if (!doc.edges.some((e) => e.id === edge.id)) return state;
      if (edge.sourceId === edge.targetId) return state;
      const ids = new Set(doc.nodes.map((n) => n.id));
      if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) return state;
      return commit(state, { ...doc, edges: doc.edges.map((e) => (e.id === edge.id ? edge : e)) });
    }

    case "removeEdges": {
      const ids = new Set(action.ids);
      if (!doc.edges.some((e) => ids.has(e.id))) return state;
      return commit(state, { ...doc, edges: doc.edges.filter((e) => !ids.has(e.id)) });
    }

    case "importDoc": {
      if (action.nodes.length === 0 && action.edges.length === 0) return state;
      if (doc.nodes.length + action.nodes.length > GRAPH_LIMITS.maxNodes) return state;
      if (doc.edges.length + action.edges.length > GRAPH_LIMITS.maxEdges) return state;
      const nodeIds = new Set(doc.nodes.map((n) => n.id));
      for (const n of action.nodes) {
        if (nodeIds.has(n.id)) return state;
        nodeIds.add(n.id);
      }
      for (const e of action.edges) {
        if (e.sourceId === e.targetId || !nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) return state;
        if (doc.edges.some((x) => x.id === e.id) || action.edges.filter((x) => x.id === e.id).length > 1) return state;
      }
      return commit(state, { nodes: [...doc.nodes, ...action.nodes], edges: [...doc.edges, ...action.edges] });
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { doc: previous, past: state.past.slice(0, -1), future: [doc, ...state.future].slice(0, HISTORY_LIMIT), version: state.version + 1 };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { doc: next, past: [...state.past, doc].slice(-HISTORY_LIMIT), future: state.future.slice(1), version: state.version + 1 };
    }
  }
}

export const canUndo = (s: EditorState) => s.past.length > 0;
export const canRedo = (s: EditorState) => s.future.length > 0;
