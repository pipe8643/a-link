import { randomUUID } from "node:crypto";
import { GRAPH_LIMITS, edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, canRedo, canUndo, editorReducer, initialState, type EditorAction, type EditorState } from "./editor-state";

const mkNode = (label: string, type: "person" | "phone" = "person"): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label });
const mkEdge = (a: GraphNodeData, b: GraphNodeData): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact" });

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);

describe("editorReducer", () => {
  it("añade, actualiza y mueve entidades", () => {
    const a = mkNode("Ana");
    let s = run(initialState(), { type: "addNode", node: a });
    expect(s.doc.nodes).toHaveLength(1);
    expect(s.version).toBe(1);

    s = run(s, { type: "updateNode", node: { ...a, label: "Ana María" } });
    expect(s.doc.nodes[0]!.label).toBe("Ana María");

    s = run(s, { type: "moveNodes", positions: [{ id: a.id, x: 10, y: 20 }] });
    expect(s.doc.nodes[0]).toMatchObject({ positionX: 10, positionY: 20 });
  });

  it("ignora ids repetidos, entidades inexistentes y posiciones no finitas", () => {
    const a = mkNode("Ana");
    const s = run(initialState(), { type: "addNode", node: a });
    expect(run(s, { type: "addNode", node: a })).toBe(s);
    expect(run(s, { type: "updateNode", node: mkNode("Otra") })).toBe(s);
    expect(run(s, { type: "moveNodes", positions: [{ id: a.id, x: Number.NaN, y: 1 }] })).toBe(s);
    expect(run(s, { type: "moveNodes", positions: [{ id: randomUUID(), x: 1, y: 1 }] })).toBe(s);
  });

  it("mover a la misma posición no ensucia el documento", () => {
    const a = { ...mkNode("Ana"), positionX: 5, positionY: 5 };
    const s = run(initialState({ nodes: [a], edges: [] }), { type: "moveNodes", positions: [{ id: a.id, x: 5, y: 5 }] });
    expect(s.version).toBe(0);
  });

  it("una arista solo existe con sus dos extremos presentes y distintos", () => {
    const a = mkNode("Ana");
    const b = mkNode("Línea", "phone");
    const base = run(initialState(), { type: "addNode", node: a }, { type: "addNode", node: b });
    const e = mkEdge(a, b);

    expect(run(base, { type: "addEdge", edge: e }).doc.edges).toHaveLength(1);
    expect(run(base, { type: "addEdge", edge: { ...e, targetId: randomUUID() } })).toBe(base); // destino inexistente
    expect(run(base, { type: "addEdge", edge: { ...e, targetId: a.id } })).toBe(base); // bucle
    const once = run(base, { type: "addEdge", edge: e });
    expect(run(once, { type: "addEdge", edge: e })).toBe(once); // id repetido
    expect(run(once, { type: "updateEdge", edge: { ...e, sourceId: randomUUID() } })).toBe(once);
  });

  it("borrar una entidad borra sus relaciones (y solo las suyas)", () => {
    const a = mkNode("A");
    const b = mkNode("B");
    const c = mkNode("C");
    const ab = mkEdge(a, b);
    const bc = mkEdge(b, c);
    const ca = mkEdge(c, a);
    const s = run(
      initialState({ nodes: [a, b, c], edges: [ab, bc, ca] }),
      { type: "removeNodes", ids: [a.id] },
    );
    expect(s.doc.nodes.map((n) => n.label)).toEqual(["B", "C"]);
    expect(s.doc.edges.map((e) => e.id)).toEqual([bc.id]);
  });

  it("borrar varias entidades es UN solo paso de historial", () => {
    const a = mkNode("A");
    const b = mkNode("B");
    const s = run(initialState({ nodes: [a, b], edges: [mkEdge(a, b)] }), { type: "removeNodes", ids: [a.id, b.id] });
    expect(s.doc).toEqual({ nodes: [], edges: [] });
    const back = run(s, { type: "undo" });
    expect(back.doc.nodes).toHaveLength(2);
    expect(back.doc.edges).toHaveLength(1);
  });

  it("deshacer y rehacer; un cambio nuevo invalida el 'rehacer'", () => {
    const a = mkNode("A");
    const b = mkNode("B");
    let s = run(initialState(), { type: "addNode", node: a }, { type: "addNode", node: b });
    expect(canUndo(s)).toBe(true);
    expect(canRedo(s)).toBe(false);

    s = run(s, { type: "undo" });
    expect(s.doc.nodes.map((n) => n.label)).toEqual(["A"]);
    expect(canRedo(s)).toBe(true);

    s = run(s, { type: "redo" });
    expect(s.doc.nodes.map((n) => n.label)).toEqual(["A", "B"]);

    s = run(s, { type: "undo" }, { type: "addNode", node: mkNode("C") });
    expect(canRedo(s)).toBe(false);
    expect(s.doc.nodes.map((n) => n.label)).toEqual(["A", "C"]);
  });

  it("deshacer/rehacer sin historial no hacen nada", () => {
    const s = initialState();
    expect(run(s, { type: "undo" })).toBe(s);
    expect(run(s, { type: "redo" })).toBe(s);
  });

  it("la versión sube también al deshacer (el autoguardado debe enterarse)", () => {
    const s = run(initialState(), { type: "addNode", node: mkNode("A") });
    expect(run(s, { type: "undo" }).version).toBeGreaterThan(s.version);
  });

  it("el historial tiene un tope", () => {
    let s = initialState();
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) s = run(s, { type: "addNode", node: mkNode(`n${i}`) });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it("respeta el límite de entidades del modelo", () => {
    const nodes = Array.from({ length: GRAPH_LIMITS.maxNodes }, (_, i) => mkNode(`n${i}`));
    const s = initialState({ nodes, edges: [] });
    expect(run(s, { type: "addNode", node: mkNode("de más") })).toBe(s);
  });

  it("cargar reemplaza el documento y vacía el historial", () => {
    const s = run(initialState(), { type: "addNode", node: mkNode("A") });
    const loaded = run(s, { type: "load", doc: { nodes: [mkNode("X")], edges: [] } });
    expect(loaded.past).toEqual([]);
    expect(loaded.version).toBe(0);
    expect(loaded.doc.nodes[0]!.label).toBe("X");
  });
});
