import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GRAPH_LIMITS, IMAGE_LIMITS, edgeInputSchema, graphSnapshotSchema, nodeInputSchema } from "../src/index.js";

const node = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), type: "person", label: "Ana", ...over });
const edge = (sourceId: string, targetId: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  sourceId,
  targetId,
  relationshipType: "family",
  ...over,
});
const issuePaths = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  (r.error?.issues ?? []).map((i) => i.path.join("."));

describe("nodeInputSchema", () => {
  it("aplica valores por defecto y normaliza", () => {
    const r = nodeInputSchema.parse(node({ label: "  Ana  ", tags: [" a ", "b"] }));
    expect(r).toMatchObject({ label: "Ana", description: "", notes: "", tags: ["a", "b"], metadata: {}, positionX: null, positionY: null });
  });

  it("exige nombre, sin saltos de línea ni caracteres de control", () => {
    expect(nodeInputSchema.safeParse(node({ label: "   " })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ label: "a\nb" })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ label: "mal\u0000" })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ label: "x".repeat(GRAPH_LIMITS.labelMax + 1) })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ label: "x".repeat(GRAPH_LIMITS.labelMax) })).success).toBe(true);
  });

  it("las notas admiten saltos de línea pero no caracteres de control", () => {
    expect(nodeInputSchema.safeParse(node({ notes: "línea 1\nlínea 2\tok" })).success).toBe(true);
    expect(nodeInputSchema.safeParse(node({ notes: "mal\u0007" })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ notes: "x".repeat(GRAPH_LIMITS.notesMax + 1) })).success).toBe(false);
  });

  it("rechaza tipos desconocidos, ids no UUID y claves extra (p. ej. graphId/ownerId)", () => {
    expect(nodeInputSchema.safeParse(node({ type: "alien" })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ id: "no-uuid" })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ ownerId: randomUUID() })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ graphId: randomUUID() })).success).toBe(false);
  });

  it("etiquetas: sin vacías, sin repetidas (sin distinguir mayúsculas) y con máximo", () => {
    expect(nodeInputSchema.safeParse(node({ tags: ["Caso", "caso"] })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ tags: [" "] })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ tags: Array.from({ length: GRAPH_LIMITS.maxTags + 1 }, (_, i) => `t${i}`) })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ tags: ["x".repeat(GRAPH_LIMITS.tagMax + 1)] })).success).toBe(false);
  });

  it("valida los metadatos con las reglas del tipo y atribuye el error al campo", () => {
    const bad = nodeInputSchema.safeParse(node({ type: "vehicle", metadata: { vin: "corto" } }));
    expect(bad.success).toBe(false);
    expect(issuePaths(bad)).toContain("metadata.vin");

    const unknown = nodeInputSchema.safeParse(node({ type: "person", metadata: { plate: "ABC-123" } }));
    expect(unknown.success).toBe(false);
    expect(issuePaths(unknown)).toContain("metadata.plate");
  });

  it("descarta metadatos vacíos y recorta valores", () => {
    const r = nodeInputSchema.parse(node({ type: "person", metadata: { fullName: "  Ana Pérez ", alias: "", observations: undefined } }));
    expect(r.metadata).toEqual({ fullName: "Ana Pérez" });
  });

  it("URL de perfil: solo http/https (bloquea javascript:)", () => {
    expect(nodeInputSchema.safeParse(node({ type: "social", metadata: { profileUrl: "javascript:alert(1)" } })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ type: "social", metadata: { profileUrl: "https://example.test/ana" } })).success).toBe(true);
  });

  it("trata payloads de SQL/XSS en el nombre como texto (no se interpretan)", () => {
    expect(nodeInputSchema.parse(node({ label: "Ana' OR 1=1 --" })).label).toBe("Ana' OR 1=1 --");
    expect(nodeInputSchema.parse(node({ label: "<script>alert(1)</script>" })).label).toBe("<script>alert(1)</script>");
    expect(nodeInputSchema.parse(node({ description: "<img src=x onerror=alert(1)>" })).description).toBe("<img src=x onerror=alert(1)>");
  });

  it("la posición es todo o nada, finita y acotada", () => {
    expect(nodeInputSchema.parse(node({ positionX: 10, positionY: null }))).toMatchObject({ positionX: null, positionY: null });
    expect(nodeInputSchema.parse(node({ positionX: 10.5, positionY: -3 }))).toMatchObject({ positionX: 10.5, positionY: -3 });
    expect(nodeInputSchema.safeParse(node({ positionX: Number.NaN, positionY: 1 })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ positionX: Infinity, positionY: 1 })).success).toBe(false);
    expect(nodeInputSchema.safeParse(node({ positionX: GRAPH_LIMITS.coordMax + 1, positionY: 1 })).success).toBe(false);
  });
});

describe("edgeInputSchema", () => {
  const a = randomUUID();
  const b = randomUUID();

  it("por defecto una relación es una HIPÓTESIS dirigida (nunca se presume un hecho)", () => {
    const r = edgeInputSchema.parse(edge(a, b));
    expect(r.metadata).toMatchObject({ evidenceClass: "hypothesis", direction: "forward" });
    expect(r.label).toBe("");
  });

  it("no admite relaciones de una entidad consigo misma", () => {
    const r = edgeInputSchema.safeParse(edge(a, a));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("targetId");
  });

  it("valida tipo de relación, fechas coherentes y confianza", () => {
    expect(edgeInputSchema.safeParse(edge(a, b, { relationshipType: "friendship" })).success).toBe(false);
    expect(edgeInputSchema.safeParse(edge(a, b, { metadata: { startDate: "2026-05-01", endDate: "2026-01-01" } })).success).toBe(false);
    expect(edgeInputSchema.safeParse(edge(a, b, { metadata: { confidence: 101 } })).success).toBe(false);
    expect(edgeInputSchema.safeParse(edge(a, b, { metadata: { confidence: 70, evidenceClass: "recorded" } })).success).toBe(true);
  });

  it("rechaza claves extra", () => {
    expect(edgeInputSchema.safeParse(edge(a, b, { graphId: randomUUID() })).success).toBe(false);
  });
});

describe("graphSnapshotSchema", () => {
  it("acepta un grafo coherente", () => {
    const n1 = node();
    const n2 = node({ type: "phone", label: "Línea 1" });
    const r = graphSnapshotSchema.safeParse({ nodes: [n1, n2], edges: [edge(n1.id, n2.id, { relationshipType: "device_usage" })] });
    expect(r.success).toBe(true);
  });

  it("rechaza aristas con extremos que no están en el grafo", () => {
    const n1 = node();
    const r = graphSnapshotSchema.safeParse({ nodes: [n1], edges: [edge(n1.id, randomUUID())] });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("edges.0.targetId");
  });

  it("rechaza identificadores repetidos", () => {
    const n1 = node();
    const r = graphSnapshotSchema.safeParse({ nodes: [n1, { ...n1, label: "Otra" }], edges: [] });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("nodes.1.id");
  });

  it("aplica los límites de tamaño", () => {
    const nodes = Array.from({ length: GRAPH_LIMITS.maxNodes + 1 }, (_, i) => node({ label: `n${i}` }));
    expect(graphSnapshotSchema.safeParse({ nodes, edges: [] }).success).toBe(false);
  });

  it("no admite claves extra", () => {
    expect(graphSnapshotSchema.safeParse({ nodes: [], edges: [], ownerId: randomUUID() }).success).toBe(false);
  });
});

describe("imageId de la entidad e IMAGE_LIMITS", () => {
  const base = { id: randomUUID(), type: "person", label: "Ana" };

  it("la imagen es opcional: sin ella queda null", () => {
    expect(nodeInputSchema.parse(base).imageId).toBeNull();
    expect(nodeInputSchema.parse({ ...base, imageId: null }).imageId).toBeNull();
  });

  it("acepta únicamente un UUID; rechaza rutas, URL, texto libre y tipos erróneos", () => {
    const id = randomUUID();
    expect(nodeInputSchema.parse({ ...base, imageId: id }).imageId).toBe(id);
    for (const bad of ["", "no-es-uuid", "../../etc/passwd", "https://evil.example/x.png", "data:image/png;base64,AAAA", 7, {}, [id]]) {
      expect(nodeInputSchema.safeParse({ ...base, imageId: bad }).success, String(bad)).toBe(false);
    }
  });

  it("los límites son coherentes: el recorte final cabe en el máximo admitido y solo hay formatos sin vectores activos", () => {
    expect(IMAGE_LIMITS.outputSide).toBeLessThanOrEqual(IMAGE_LIMITS.maxSide);
    expect(IMAGE_LIMITS.maxBytes).toBeLessThanOrEqual(IMAGE_LIMITS.maxBytesPerUser);
    expect([...IMAGE_LIMITS.mimeTypes].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(GRAPH_LIMITS.maxImagesPerGraph).toBeGreaterThan(0);
  });
});