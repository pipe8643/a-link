import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGraphView } from "./use-graph-view";

const node = (label: string, type = "person"): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label });
const edge = (a: GraphNodeData, b: GraphNodeData): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact", metadata: {} });

// a — b — c — d ; p (teléfono) — a
const a = node("A");
const b = node("B");
const c = node("C");
const d = node("D");
const p = node("P", "phone");
const doc: GraphSnapshot = { nodes: [a, b, c, d, p], edges: [edge(a, b), edge(b, c), edge(c, d), edge(a, p)] };
const NO_PIN = { nodeIds: [] as string[], edgeIds: [] as string[] };

const setup = (pinned = NO_PIN, d0: GraphSnapshot = doc) => renderHook(({ pin, document }) => useGraphView(document, pin), { initialProps: { pin: pinned, document: d0 } });
const ids = (r: { current: ReturnType<typeof useGraphView> }) => r.current.result.doc.nodes.map((n) => n.label).sort();

describe("useGraphView", () => {
  it("al empezar se ve todo y el documento pasa tal cual", () => {
    const { result } = setup();
    expect(result.current.result.doc).toBe(doc);
    expect(result.current.result.filtered).toBe(false);
    expect(result.current.auraMode).toBe("none");
  });

  it("filtrar por tipo oculta y volver a marcarlo lo recupera", () => {
    const { result } = setup();
    act(() => result.current.toggleType("phone"));
    expect(ids(result)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.result.hiddenNodes).toBe(1);
    act(() => result.current.toggleType("phone"));
    expect(result.current.result.filtered).toBe(false);
  });

  it("enfocar muestra la entidad y sus vecinas; expandir suma las siguientes; contraer las quita", () => {
    const { result } = setup();
    act(() => result.current.focusOn([b.id]));
    expect(ids(result)).toEqual(["A", "B", "C"]);
    expect(result.current.hiddenNeighborIds(c.id)).toEqual([d.id]);
    act(() => result.current.expand(c.id));
    expect(ids(result)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.canCollapse(c.id)).toBe(true);
    act(() => result.current.collapse(c.id));
    expect(ids(result)).toEqual(["A", "B", "C"]);
  });

  it("doble clic: sin enfoque no hace nada; con enfoque expande y luego contrae", () => {
    const { result } = setup();
    let r: ReturnType<typeof result.current.toggleExpand> = null;
    act(() => void (r = result.current.toggleExpand(c.id)));
    expect(r).toBeNull();
    expect(result.current.result.filtered).toBe(false);

    act(() => result.current.focusOn([b.id]));
    act(() => void (r = result.current.toggleExpand(c.id)));
    expect(r).toBe("expanded");
    expect(ids(result)).toContain("D");
    act(() => void (r = result.current.toggleExpand(c.id)));
    expect(r).toBe("collapsed");
    expect(ids(result)).not.toContain("D");
    // Sin nada que abrir ni cerrar (D es una hoja no expandida): nada.
    act(() => void (r = result.current.toggleExpand(a.id)));
    expect(r).toBe("expanded"); // A tiene un vecino oculto: P
    expect(ids(result)).toContain("P");
  });

  it("la selección siempre se ve, aunque el filtro la ocultaría", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleType("phone"));
    expect(ids(result)).not.toContain("P");
    rerender({ pin: { nodeIds: [p.id], edgeIds: [] }, document: doc });
    expect(ids(result)).toContain("P");
    rerender({ pin: NO_PIN, document: doc });
    expect(ids(result)).not.toContain("P");
  });

  it("una entidad nueva reaparece: su tipo deja de estar oculto y entra en el enfoque", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleType("phone"));
    act(() => result.current.focusOn([a.id]));
    const fresh = node("Nuevo", "phone");
    rerender({ pin: NO_PIN, document: { nodes: [...doc.nodes, fresh], edges: doc.edges } });
    expect(ids(result)).not.toContain("Nuevo");
    act(() => result.current.reveal(fresh.id, "phone"));
    expect(result.current.view.hiddenTypes).toEqual([]);
    expect(ids(result)).toContain("Nuevo");
  });

  it("«Quitar filtros» conserva el enfoque y «Mostrar todo» lo quita todo, pero no los halos", () => {
    const { result } = setup();
    act(() => {
      result.current.toggleType("phone");
      result.current.focusOn([b.id]);
      result.current.setAuraMode("type");
    });
    act(() => result.current.clearFilters());
    expect(result.current.view.hiddenTypes).toEqual([]);
    expect(result.current.result.focusActive).toBe(true);
    act(() => result.current.showAll());
    expect(result.current.result.filtered).toBe(false);
    expect(result.current.auraMode).toBe("type");
  });

  it("filtros de fecha y de naturaleza llegan a la vista", () => {
    const dated = edgeInputSchema.parse({ id: randomUUID(), sourceId: c.id, targetId: d.id, relationshipType: "contact", metadata: { startDate: "2020-01-01", endDate: "2020-12-31", evidenceClass: "recorded" } });
    const d2: GraphSnapshot = { nodes: doc.nodes, edges: [edge(a, b), dated] };
    const { result } = setup(NO_PIN, d2);
    act(() => result.current.setDates("2021-01-01", ""));
    expect(result.current.result.doc.edges).toHaveLength(1); // la fechada queda fuera; la que no tiene fecha se mantiene
    act(() => result.current.setIncludeUndated(false));
    expect(result.current.result.doc.edges).toHaveLength(0);
    act(() => result.current.clearFilters());
    act(() => result.current.toggleEvidence("recorded"));
    expect(result.current.result.doc.edges).toHaveLength(1);
  });
});
