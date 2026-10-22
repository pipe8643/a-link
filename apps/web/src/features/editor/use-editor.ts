import type { EntityTypeId, GraphEdgeData, GraphNodeData, GraphSnapshot } from "@a-link/shared";
import { useCallback, useMemo, useReducer, useState } from "react";
import { buildNode, type FormErrors } from "./editor-commands";
import { canRedo, canUndo, editorReducer, initialState } from "./editor-state";
import type { CanvasSelection } from "./net-chart-canvas";

const NONE: CanvasSelection = { nodeIds: [], edgeIds: [] };

/**
 * Estado completo del editor: documento con historial + selección. Todas las operaciones pasan por el
 * reductor (que garantiza los invariantes) y por los esquemas compartidos (que validan el contenido).
 */
export function useEditor(initialDoc?: GraphSnapshot) {
  const [state, dispatch] = useReducer(editorReducer, initialDoc, (doc) => initialState(doc));
  const [rawSelection, setSelection] = useState<CanvasSelection>(NONE);
  const { doc } = state;

  // La selección nunca apunta a elementos que ya no existen (borrados, deshechos…).
  const selection = useMemo<CanvasSelection>(() => {
    const nodeIds = new Set(doc.nodes.map((n) => n.id));
    const edgeIds = new Set(doc.edges.map((e) => e.id));
    const nodes = rawSelection.nodeIds.filter((id) => nodeIds.has(id));
    const edges = rawSelection.edgeIds.filter((id) => edgeIds.has(id));
    return nodes.length === rawSelection.nodeIds.length && edges.length === rawSelection.edgeIds.length ? rawSelection : { nodeIds: nodes, edgeIds: edges };
  }, [rawSelection, doc]);

  const nodesById = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);
  const edgesById = useMemo(() => new Map(doc.edges.map((e) => [e.id, e])), [doc.edges]);

  const addEntity = useCallback(
    (type: EntityTypeId): { ok: true; node: GraphNodeData } | { ok: false; errors: FormErrors } => {
      const r = buildNode(type, doc.nodes);
      if (!r.ok) return r;
      dispatch({ type: "addNode", node: r.value });
      setSelection({ nodeIds: [r.value.id], edgeIds: [] });
      return { ok: true, node: r.value };
    },
    [doc.nodes],
  );

  const updateEntity = useCallback((node: GraphNodeData) => dispatch({ type: "updateNode", node }), []);

  const addRelationship = useCallback((edge: GraphEdgeData) => {
    dispatch({ type: "addEdge", edge });
    setSelection({ nodeIds: [], edgeIds: [edge.id] });
  }, []);

  const updateRelationship = useCallback((edge: GraphEdgeData) => dispatch({ type: "updateEdge", edge }), []);

  const deleteSelection = useCallback(() => {
    if (selection.nodeIds.length > 0) dispatch({ type: "removeNodes", ids: selection.nodeIds });
    if (selection.edgeIds.length > 0) dispatch({ type: "removeEdges", ids: selection.edgeIds });
    setSelection(NONE);
  }, [selection]);

  const moveNodes = useCallback((positions: Array<{ id: string; x: number; y: number }>) => dispatch({ type: "moveNodes", positions }), []);

  return {
    state,
    doc,
    selection,
    setSelection,
    nodesById,
    edgesById,
    addEntity,
    updateEntity,
    addRelationship,
    updateRelationship,
    deleteSelection,
    moveNodes,
    /** Sustituye el documento (p. ej. al recargar la versión del servidor): vacía el historial y la selección. */
    load: useCallback((next: GraphSnapshot) => {
      dispatch({ type: "load", doc: next });
      setSelection(NONE);
    }, []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    /** Sube con cada cambio; el autoguardado lo compara con el último valor guardado. */
    version: state.version,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
