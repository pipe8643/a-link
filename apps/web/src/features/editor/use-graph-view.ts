import type { EntityTypeId, EvidenceClass, GraphSnapshot } from "@a-link/shared";
import { useCallback, useMemo, useState } from "react";
import type { AuraMode } from "./auras";
import {
  EMPTY_VIEW,
  addToFocus,
  collapseNode,
  computeView,
  expandNode,
  focusOn,
  hiddenNeighbors,
  toggleExplore,
  toggleInList,
  type ExploreAction,
  type Pinned,
  type ViewResult,
  type ViewState,
} from "./view-filter";

export interface GraphViewApi {
  view: ViewState;
  /** Lo que se ve ahora mismo (`result.doc` es lo que recibe el lienzo). */
  result: ViewResult;
  auraMode: AuraMode;
  setAuraMode(mode: AuraMode): void;
  toggleType(type: EntityTypeId): void;
  toggleEvidence(evidence: EvidenceClass): void;
  setDates(from: string, to: string): void;
  setIncludeUndated(value: boolean): void;
  /** Quita filtros y enfoque: vuelve a verse todo el grafo (los halos se conservan). */
  showAll(): void;
  /** Quita solo los filtros y deja el enfoque. */
  clearFilters(): void;
  focusOn(ids: readonly string[]): void;
  expand(id: string): void;
  collapse(id: string): void;
  /** Doble clic del editor: abre los vecinos ocultos o, si ya estaban abiertos, los cierra. Sin enfoque no hace nada. */
  toggleExpand(id: string): "expanded" | "collapsed" | null;
  /**
   * Doble clic del visor compartido: retrae a un nodo principal, extiende/contrae vecinos o vuelve a mostrar todo.
   * El editor sigue usando `toggleExpand` (no cambia datos).
   */
  explore(id: string): ExploreAction;
  /** Una entidad recién creada: se añade al enfoque y su tipo deja de estar oculto. */
  reveal(id: string, type: EntityTypeId): void;
  hiddenNeighborIds(id: string): string[];
  canCollapse(id: string): boolean;
}

/**
 * Estado de la vista del editor (filtros, enfoque y halos). Es solo presentación: el documento, el historial y el
 * autoguardado no se enteran. La selección actual siempre se ve (`pinned`).
 */
export function useGraphView(doc: GraphSnapshot, pinned: Pinned): GraphViewApi {
  const [view, setView] = useState<ViewState>(EMPTY_VIEW);
  const [auraMode, setAuraMode] = useState<AuraMode>("none");

  const pinNodes = pinned.nodeIds;
  const pinEdges = pinned.edgeIds;
  const result = useMemo(() => computeView(doc, view, { nodeIds: pinNodes, edgeIds: pinEdges }), [doc, view, pinNodes, pinEdges]);

  const toggleType = useCallback((type: EntityTypeId) => setView((v) => ({ ...v, hiddenTypes: toggleInList(v.hiddenTypes, type) })), []);
  const toggleEvidence = useCallback((e: EvidenceClass) => setView((v) => ({ ...v, hiddenEvidence: toggleInList(v.hiddenEvidence, e) })), []);
  const setDates = useCallback((dateFrom: string, dateTo: string) => setView((v) => ({ ...v, dateFrom, dateTo })), []);
  const setIncludeUndated = useCallback((includeUndated: boolean) => setView((v) => ({ ...v, includeUndated })), []);
  const showAll = useCallback(() => setView(EMPTY_VIEW), []);
  const clearFilters = useCallback(() => setView((v) => ({ ...EMPTY_VIEW, focus: v.focus })), []);
  const focus = useCallback((ids: readonly string[]) => setView((v) => focusOn(v, ids)), []);
  const expand = useCallback((id: string) => setView((v) => expandNode(v, id)), []);
  const collapse = useCallback((id: string) => setView((v) => collapseNode(v, id)), []);
  const reveal = useCallback(
    (id: string, type: EntityTypeId) => setView((v) => addToFocus({ ...v, hiddenTypes: v.hiddenTypes.filter((t) => t !== type) }, id)),
    [],
  );

  const hiddenNeighborIds = useCallback((id: string) => hiddenNeighbors(doc, view, result, id), [doc, view, result]);
  const canCollapse = useCallback((id: string) => !!view.focus?.expanded.includes(id), [view.focus]);

  const toggleExpand = useCallback(
    (id: string): "expanded" | "collapsed" | null => {
      if (!result.focusActive) return null;
      if (hiddenNeighbors(doc, view, result, id).length > 0) {
        setView((v) => expandNode(v, id));
        return "expanded";
      }
      if (view.focus?.expanded.includes(id)) {
        setView((v) => collapseNode(v, id));
        return "collapsed";
      }
      return null;
    },
    [doc, view, result],
  );

  const explore = useCallback(
    (id: string): ExploreAction => {
      const next = toggleExplore(view, result, doc, id);
      if (next.action) setView(next.view);
      return next.action;
    },
    [doc, view, result],
  );

  return useMemo(
    () => ({
      view,
      result,
      auraMode,
      setAuraMode,
      toggleType,
      toggleEvidence,
      setDates,
      setIncludeUndated,
      showAll,
      clearFilters,
      focusOn: focus,
      expand,
      collapse,
      toggleExpand,
      explore,
      reveal,
      hiddenNeighborIds,
      canCollapse,
    }),
    [view, result, auraMode, toggleType, toggleEvidence, setDates, setIncludeUndated, showAll, clearFilters, focus, expand, collapse, toggleExpand, explore, reveal, hiddenNeighborIds, canCollapse],
  );
}
