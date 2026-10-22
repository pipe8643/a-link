import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import {
  EMPTY_VIEW,
  addToFocus,
  clearFocus,
  collapseNode,
  computeView,
  edgeAllowed,
  expandNode,
  focusOn,
  hiddenNeighbors,
  toggleExplore,
  toggleInList,
  visibleNeighbors,
  type ViewState,
} from "./view-filter";

const node = (label: string, type = "person"): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label });
const edge = (a: GraphNodeData, b: GraphNodeData, meta: Record<string, unknown> = {}): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact", metadata: { direction: "forward", evidenceClass: "recorded", ...meta } });

// Cadena A–B–C–D–E, más una persona F aislada y un teléfono P unido a A.
const A = node("A");
const B = node("B");
const C = node("C");
const D = node("D");
const E = node("E");
const F = node("F");
const P = node("P", "phone");
const eAB = edge(A, B);
const eBC = edge(B, C, { evidenceClass: "hypothesis" });
const eCD = edge(C, D, { startDate: "2020-01-01", endDate: "2020-12-31" });
const eDE = edge(D, E, { startDate: "2022-06-01" });
const eAP = edge(A, P, { evidenceClass: "observation" });
const doc: GraphSnapshot = { nodes: [A, B, C, D, E, F, P], edges: [eAB, eBC, eCD, eDE, eAP] };
const ids = (r: { doc: GraphSnapshot }) => r.doc.nodes.map((n) => n.label).sort();
const view = (over: Partial<ViewState>): ViewState => ({ ...EMPTY_VIEW, ...over });

describe("sin filtros", () => {
  it("devuelve el MISMO documento (el lienzo no hace nada)", () => {
    const r = computeView(doc, EMPTY_VIEW);
    expect(r.doc).toBe(doc);
    expect(r.filtered).toBe(false);
    expect(r.hiddenNodes).toBe(0);
  });
});

describe("filtros", () => {
  it("ocultar un tipo quita sus entidades y las relaciones que quedan sin extremo", () => {
    const r = computeView(doc, view({ hiddenTypes: ["phone"] }));
    expect(ids(r)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(r.doc.edges).not.toContain(eAP);
    expect(r.hiddenNodes).toBe(1);
    expect(r.hiddenEdges).toBe(1);
    expect(r.filtered).toBe(true);
  });

  it("ocultar una naturaleza quita solo esas relaciones, no las entidades", () => {
    const r = computeView(doc, view({ hiddenEvidence: ["hypothesis", "observation"] }));
    expect(r.doc.nodes).toHaveLength(7);
    expect(r.doc.edges).toEqual([eAB, eCD, eDE]);
  });

  it("conserva la identidad de los objetos (el lienzo solo sincroniza diferencias)", () => {
    const r = computeView(doc, view({ hiddenTypes: ["phone"] }));
    expect(r.doc.nodes[0]).toBe(A);
    expect(r.doc.edges[0]).toBe(eAB);
  });

  it("rango de fechas: intervalo que toca el rango; abiertos por un lado; sin fecha según la casilla", () => {
    const only2020 = view({ dateFrom: "2020-06-01", dateTo: "2020-06-30" });
    expect(edgeAllowed(eCD, only2020)).toBe(true); // 2020 entero contiene junio
    expect(edgeAllowed(eDE, only2020)).toBe(false); // empieza en 2022
    expect(edgeAllowed(eAB, only2020)).toBe(true); // sin fecha, includeUndated por defecto
    expect(edgeAllowed(eAB, { ...only2020, includeUndated: false })).toBe(false);

    const after2023 = view({ dateFrom: "2023-01-01" });
    expect(edgeAllowed(eDE, after2023)).toBe(true); // «desde 2022-06 sin fin» sigue vigente
    expect(edgeAllowed(eCD, after2023)).toBe(false); // terminó en 2020

    const before2019 = view({ dateTo: "2019-12-31" });
    expect(edgeAllowed(eCD, before2019)).toBe(false);
    expect(edgeAllowed(eDE, before2019)).toBe(false);
  });

  it("los extremos del rango son inclusivos", () => {
    expect(edgeAllowed(eCD, view({ dateFrom: "2020-12-31" }))).toBe(true);
    expect(edgeAllowed(eCD, view({ dateFrom: "2021-01-01" }))).toBe(false);
    expect(edgeAllowed(eCD, view({ dateTo: "2020-01-01" }))).toBe(true);
    expect(edgeAllowed(eCD, view({ dateTo: "2019-12-31" }))).toBe(false);
  });

  it("lo seleccionado se ve siempre, aunque su tipo esté oculto; una relación seleccionada trae sus extremos", () => {
    const hidden = view({ hiddenTypes: ["phone", "person"] });
    expect(computeView(doc, hidden).doc.nodes).toHaveLength(0);
    expect(ids(computeView(doc, hidden, { nodeIds: [P.id] }))).toEqual(["P"]);
    const r = computeView(doc, hidden, { edgeIds: [eAB.id] });
    expect(ids(r)).toEqual(["A", "B"]);
    expect(r.doc.edges).toEqual([eAB]);
  });
});

describe("enfoque y expansión", () => {
  it("raíz = ella y sus vecinos directos; el resto queda oculto", () => {
    const r = computeView(doc, focusOn(EMPTY_VIEW, [B.id]));
    expect(ids(r)).toEqual(["A", "B", "C"]);
    expect(r.doc.edges).toEqual([eAB, eBC]);
    expect(r.focusActive).toBe(true);
    expect(r.hiddenNodes).toBe(4);
  });

  it("expandir un vecino suma los suyos; contraer los quita", () => {
    let v = focusOn(EMPTY_VIEW, [B.id]);
    v = expandNode(v, C.id);
    expect(ids(computeView(doc, v))).toEqual(["A", "B", "C", "D"]);
    v = expandNode(v, D.id);
    expect(ids(computeView(doc, v))).toEqual(["A", "B", "C", "D", "E"]);
    v = collapseNode(v, D.id);
    expect(ids(computeView(doc, v))).toEqual(["A", "B", "C", "D"]);
    v = collapseNode(v, C.id);
    expect(ids(computeView(doc, v))).toEqual(["A", "B", "C"]);
  });

  it("expandir sin enfoque previo lo crea; expandir dos veces o una raíz no cambia nada", () => {
    const v = expandNode(EMPTY_VIEW, A.id);
    expect(v.focus).toEqual({ roots: [A.id], expanded: [] });
    expect(expandNode(v, A.id)).toBe(v);
    const v2 = expandNode(v, B.id);
    expect(expandNode(v2, B.id)).toBe(v2);
  });

  it("una raíz no se contrae; contraer algo no expandido no cambia nada", () => {
    const v = focusOn(EMPTY_VIEW, [A.id]);
    expect(collapseNode(v, A.id)).toBe(v);
    expect(collapseNode(v, C.id)).toBe(v);
    expect(collapseNode(EMPTY_VIEW, A.id)).toBe(EMPTY_VIEW);
  });

  it("los filtros se combinan con el enfoque: no se llega a vecinos por relaciones filtradas", () => {
    // Con las hipótesis ocultas, B no llega a C.
    const v = { ...focusOn(EMPTY_VIEW, [B.id]), hiddenEvidence: ["hypothesis" as const] };
    expect(ids(computeView(doc, v))).toEqual(["A", "B"]);
    // Y un tipo oculto no aparece aunque sea vecino.
    const v2 = { ...focusOn(EMPTY_VIEW, [A.id]), hiddenTypes: ["phone" as const] };
    expect(ids(computeView(doc, v2))).toEqual(["A", "B"]);
  });

  it("varias raíces", () => {
    expect(ids(computeView(doc, focusOn(EMPTY_VIEW, [A.id, E.id])))).toEqual(["A", "B", "D", "E", "P"]);
  });

  it("raíces borradas: si no queda ninguna, el enfoque se ignora; si quedan, se usan las que existen", () => {
    const ghost = randomUUID();
    expect(computeView(doc, focusOn(EMPTY_VIEW, [ghost])).filtered).toBe(false);
    expect(ids(computeView(doc, focusOn(EMPTY_VIEW, [ghost, B.id])))).toEqual(["A", "B", "C"]);
  });

  it("focusOn con lista vacía y clearFocus quitan el enfoque", () => {
    expect(focusOn(focusOn(EMPTY_VIEW, [A.id]), []).focus).toBeNull();
    expect(clearFocus(focusOn(EMPTY_VIEW, [A.id])).focus).toBeNull();
    expect(clearFocus(EMPTY_VIEW)).toBe(EMPTY_VIEW);
  });

  it("addToFocus: una entidad nueva no desaparece; sin enfoque no hace nada", () => {
    const v = focusOn(EMPTY_VIEW, [A.id]);
    const n = node("Nueva");
    const withNew = { nodes: [...doc.nodes, n], edges: doc.edges };
    expect(ids(computeView(withNew, addToFocus(v, n.id)))).toContain("Nueva");
    expect(ids(computeView(withNew, v))).not.toContain("Nueva");
    expect(addToFocus(EMPTY_VIEW, n.id)).toBe(EMPTY_VIEW);
    expect(addToFocus(v, A.id)).toBe(v);
  });

  it("vecinos ocultos y visibles de una entidad", () => {
    const v = focusOn(EMPTY_VIEW, [B.id]);
    const r = computeView(doc, v);
    expect(hiddenNeighbors(doc, v, r, C.id)).toEqual([D.id]);
    expect(hiddenNeighbors(doc, v, r, B.id)).toEqual([]);
    expect(hiddenNeighbors(doc, v, r, A.id)).toEqual([P.id]);
    expect(visibleNeighbors(doc, v, C.id).sort()).toEqual([B.id, D.id].sort());
    expect(hiddenNeighbors(doc, v, r, F.id)).toEqual([]);
  });
});

describe("toggleExplore (visor / PowerPoint vivo)", () => {
  const step = (v: ViewState, id: string) => {
    const r = computeView(doc, v);
    return toggleExplore(v, r, doc, id);
  };

  it("sin enfoque, un clic retrae a ese nodo y sus vecinos", () => {
    const { view: v, action } = step(EMPTY_VIEW, B.id);
    expect(action).toBe("focused");
    expect(ids(computeView(doc, v))).toEqual(["A", "B", "C"]);
  });

  it("en un vecino con más conexiones, extiende y luego contrae", () => {
    let v = focusOn(EMPTY_VIEW, [B.id]);
    const open = step(v, C.id);
    expect(open.action).toBe("expanded");
    expect(ids(computeView(doc, open.view))).toEqual(["A", "B", "C", "D"]);
    const close = step(open.view, C.id);
    expect(close.action).toBe("collapsed");
    expect(ids(computeView(doc, close.view))).toEqual(["A", "B", "C"]);
  });

  it("en la raíz: primero cierra lo extendido; después muestra todo el grafo", () => {
    let v = expandNode(focusOn(EMPTY_VIEW, [B.id]), C.id);
    const fold = step(v, B.id);
    expect(fold.action).toBe("collapsed");
    expect(ids(computeView(doc, fold.view))).toEqual(["A", "B", "C"]);
    const all = step(fold.view, B.id);
    expect(all.action).toBe("showall");
    expect(computeView(doc, all.view).filtered).toBe(false);
  });

  it("un id desconocido no cambia nada", () => {
    const { view: v, action } = step(EMPTY_VIEW, randomUUID());
    expect(action).toBeNull();
    expect(v).toBe(EMPTY_VIEW);
  });
});

describe("toggleInList", () => {
  it("añade y quita sin mutar", () => {
    const a = ["x"] as const;
    expect(toggleInList(a, "y")).toEqual(["x", "y"]);
    expect(toggleInList(a, "x")).toEqual([]);
    expect(a).toEqual(["x"]);
  });
});
