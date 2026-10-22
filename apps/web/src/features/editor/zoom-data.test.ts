import { randomUUID } from "node:crypto";
import { type GraphEdgeData, type GraphNodeData } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import { toZoomData, toZoomLink, toZoomNode } from "./zoom-data";

const node = (over: Partial<GraphNodeData> = {}): GraphNodeData => ({
  id: randomUUID(),
  type: "person",
  label: "Ana Prueba",
  description: "",
  notes: "",
  tags: [],
  metadata: {},
  imageId: null,
  positionX: null,
  positionY: null,
  ...over,
});

const edge = (a: string, b: string, over: Partial<GraphEdgeData> = {}): GraphEdgeData => ({
  id: randomUUID(),
  sourceId: a,
  targetId: b,
  relationshipType: "association",
  label: "",
  metadata: { direction: "forward", evidenceClass: "hypothesis" },
  ...over,
});

describe("imagen de la entidad en el lienzo", () => {
  const imageId = randomUUID();
  const resolver = (n: GraphNodeData) => `/api/v1/graphs/g/images/${n.imageId}`;

  it("pasa la URL de la imagen al estilo del nodo solo si la entidad tiene imagen y hay resolutor", () => {
    expect(toZoomNode(node({ imageId }), "none", undefined, resolver).style?.image).toBe(`/api/v1/graphs/g/images/${imageId}`);
    expect(toZoomNode(node({ imageId: null }), "none", undefined, resolver).style).not.toHaveProperty("image");
    expect(toZoomNode(node({ imageId })).style).not.toHaveProperty("image");
    expect(toZoomNode(node({ imageId }), "none", undefined, () => undefined).style).not.toHaveProperty("image");
  });

  it("toZoomData propaga el resolutor a todos los nodos", () => {
    const withImage = node({ imageId });
    const plain = node();
    const data = toZoomData({ nodes: [withImage, plain], edges: [] }, "none", resolver);
    expect(data.nodes.map((n) => n.style?.image)).toEqual([`/api/v1/graphs/g/images/${imageId}`, undefined]);
  });
});

describe("toZoomData", () => {
  it("convierte nodos con forma personalizada y sin posición fijada si no la tienen", () => {
    const n = toZoomNode(node());
    expect(n.loaded).toBe(true);
    expect(n.style?.display).toBe("customShape");
    expect(n.style?.customShape).toBeDefined();
    expect(n.style?.label).toBe("Ana Prueba");
    expect(n.x).toBeUndefined();
    expect(n.locked).toBeUndefined();
  });

  it("respeta la posición guardada y fija el nodo", () => {
    const n = toZoomNode(node({ positionX: 120.5, positionY: -40 }));
    expect(n.x).toBe(120.5);
    expect(n.y).toBe(-40);
    expect(n.locked).toBe(true);
  });

  it("reutiliza la misma forma por tipo (sin crear una por nodo)", () => {
    expect(toZoomNode(node()).style?.customShape).toBe(toZoomNode(node()).style?.customShape);
    expect(toZoomNode(node({ type: "vehicle" })).style?.customShape).not.toBe(toZoomNode(node()).style?.customShape);
  });

  it("codifica la certeza con el trazo, no solo con el color", () => {
    const a = node();
    const b = node();
    const recorded = toZoomLink(edge(a.id, b.id, { metadata: { direction: "forward", evidenceClass: "recorded" } }));
    const hypothesis = toZoomLink(edge(a.id, b.id));
    const observation = toZoomLink(edge(a.id, b.id, { metadata: { direction: "forward", evidenceClass: "observation" } }));
    expect(recorded.style?.lineDash).toBeUndefined();
    expect(hypothesis.style?.lineDash).toEqual([10, 6]);
    expect(observation.style?.lineDash).toEqual([2, 6]);
  });

  it("codifica la dirección con flechas", () => {
    const a = node();
    const b = node();
    const dir = (direction: "forward" | "none" | "both") => toZoomLink(edge(a.id, b.id, { metadata: { direction, evidenceClass: "recorded" } })).style;
    expect(dir("forward")).toMatchObject({ toDecoration: "arrow", fromDecoration: undefined });
    expect(dir("none")).toMatchObject({ toDecoration: undefined, fromDecoration: undefined });
    expect(dir("both")).toMatchObject({ toDecoration: "arrow", fromDecoration: "arrow" });
  });

  it("usa la etiqueta propia o, si falta, el nombre del tipo de relación", () => {
    const a = node();
    const b = node();
    expect(toZoomLink(edge(a.id, b.id, { label: "Primos" })).style?.label).toBe("Primos");
    expect(toZoomLink(edge(a.id, b.id)).style?.label).toBeTruthy();
  });

  it("convierte un documento completo conservando los ids", () => {
    const a = node();
    const b = node({ type: "organization", label: "Empresa Demo" });
    const e = edge(a.id, b.id);
    const out = toZoomData({ nodes: [a, b], edges: [e] });
    expect(out.nodes.map((n) => n.id)).toEqual([a.id, b.id]);
    expect(out.links[0]).toMatchObject({ id: e.id, from: a.id, to: b.id });
  });
});
