import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_AREA_PX,
  MAX_SIDE_PX,
  computeOutputSize,
  defaultExportOptions,
  exportOptionsSchema,
  normalizeOptions,
  safeFileName,
  sizeForRatio,
} from "./export-options";
import { boundsOf, contentAspect, gridLayout, resolvePositions, withPositions } from "./layout";
import { buildLegend } from "./legend";

const node = (label: string, extra: Record<string, unknown> = {}, type = "person"): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label, ...extra });
const edge = (a: GraphNodeData, b: GraphNodeData, evidenceClass?: string): GraphEdgeData =>
  edgeInputSchema.parse({
    id: randomUUID(),
    sourceId: a.id,
    targetId: b.id,
    relationshipType: "contact",
    ...(evidenceClass ? { metadata: { direction: "forward", evidenceClass } } : {}),
  });
const snap = (nodes: GraphNodeData[], edges: GraphEdgeData[] = []): GraphSnapshot => ({ nodes, edges });

describe("safeFileName", () => {
  it("elimina separadores de ruta, caracteres de control y reservados", () => {
    expect(safeFileName("../../etc/passwd")).toBe("etc passwd");
    expect(safeFileName('a<b>c:d"e|f?g*h')).toBe("a b c d e f g h");
    expect(safeFileName("línea\u0000\u001fnueva")).toBe("línea nueva");
  });
  it("evita nombres reservados de Windows, vacíos y puntos finales", () => {
    expect(safeFileName("CON")).toBe("grafo");
    expect(safeFileName("lpt1")).toBe("grafo");
    expect(safeFileName("   ")).toBe("grafo");
    expect(safeFileName("...")).toBe("grafo");
    expect(safeFileName("informe.")).toBe("informe");
    expect(safeFileName("", "otro")).toBe("otro");
  });
  it("acota la longitud", () => {
    expect(safeFileName("a".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe("opciones de exportación", () => {
  it("el esquema es estricto: rechaza claves desconocidas y valores fuera de rango", () => {
    const ok = defaultExportOptions("Mi grafo", false);
    expect(exportOptionsSchema.safeParse(ok).success).toBe(true);
    expect(exportOptionsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(exportOptionsSchema.safeParse({ ...ok, resolution: 4 }).success).toBe(false);
    expect(exportOptionsSchema.safeParse({ ...ok, format: "gif" }).success).toBe(false);
  });
  it("los valores por defecto siguen el tema actual", () => {
    expect(defaultExportOptions("x", true)).toMatchObject({ background: "dark", theme: "dark" });
    expect(defaultExportOptions("x", false)).toMatchObject({ background: "white", theme: "light" });
  });
  it("transparente solo existe en PNG; el fondo manda sobre el tema de las etiquetas", () => {
    const base = defaultExportOptions("x", false);
    expect(normalizeOptions({ ...base, format: "png", background: "transparent" }).background).toBe("transparent");
    expect(normalizeOptions({ ...base, format: "jpeg", background: "transparent" }).background).toBe("white");
    expect(normalizeOptions({ ...base, format: "pdf", background: "transparent", theme: "dark" }).background).toBe("dark");
    expect(normalizeOptions({ ...base, background: "dark", theme: "light" }).theme).toBe("dark");
    expect(normalizeOptions({ ...base, background: "white", theme: "dark" }).theme).toBe("light");
  });
});

describe("tamaño de salida", () => {
  it("respeta la proporción pedida y la resolución", () => {
    const s = computeOutputSize("16:9", 2);
    expect(s.width).toBe(1200);
    expect(s.height).toBe(675);
    expect(s.pixelWidth).toBe(2400);
    expect(s.pixelHeight).toBe(1350);
    expect(s.reduced).toBe(false);
  });
  it("los formatos verticales no quedan diminutos", () => {
    const s = computeOutputSize("a4-portrait", 1);
    expect(s.height).toBe(1200);
    expect(s.width).toBeLessThan(s.height);
  });
  it("«ajustada» usa la proporción del grafo, acotada a 0,25–4", () => {
    expect(computeOutputSize("fit", 1, 2).width / computeOutputSize("fit", 1, 2).height).toBeCloseTo(2, 1);
    expect(computeOutputSize("fit", 1, 100).height).toBe(300);
    expect(computeOutputSize("fit", 1, 0.0001).width).toBe(300);
    expect(computeOutputSize("fit", 1, Number.NaN).width).toBe(1200);
  });
  it("nunca supera los límites del navegador: baja la resolución y lo avisa", () => {
    for (const ratio of [0.25, 0.5, 1, 2, 4]) {
      for (const res of [1, 2, 3] as const) {
        const s = sizeForRatio(ratio, res);
        expect(s.pixelWidth).toBeLessThanOrEqual(MAX_SIDE_PX);
        expect(s.pixelHeight).toBeLessThanOrEqual(MAX_SIDE_PX);
        expect(s.pixelWidth * s.pixelHeight).toBeLessThanOrEqual(MAX_AREA_PX);
        expect(s.scale).toBeGreaterThanOrEqual(1);
        expect(s.reduced).toBe(s.scale !== res);
      }
    }
    expect(sizeForRatio(1, 3, 3000).reduced).toBe(true);
    expect(sizeForRatio(1, 3, 3000).scale).toBe(2);
    // Solo el límite de ÁREA: 7200×7200 px cabe por lado (< 8192) pero son 51,8 Mpx (> 40).
    const byArea = sizeForRatio(1, 3, 2400);
    expect(byArea.scale).toBe(2);
    expect(byArea.reduced).toBe(true);
  });
});

describe("posiciones", () => {
  it("prioridad: lienzo > documento > cuadrícula; todas finitas", () => {
    const a = node("Ana", { positionX: 10, positionY: 20 });
    const b = node("Beto", { positionX: 30, positionY: 40 });
    const c = node("Carla");
    const live = new Map([[a.id, { x: 100, y: 200 }]]);
    const pos = resolvePositions(snap([a, b, c]), live);
    expect(pos.get(a.id)).toEqual({ x: 100, y: 200 });
    expect(pos.get(b.id)).toEqual({ x: 30, y: 40 });
    const pc = pos.get(c.id)!;
    expect(Number.isFinite(pc.x) && Number.isFinite(pc.y)).toBe(true);
    // Las colocadas por cuadrícula quedan debajo de lo ya colocado: no se solapan.
    expect(pc.y).toBeGreaterThan(200);
  });
  it("ignora posiciones del lienzo no finitas", () => {
    const a = node("Ana", { positionX: 1, positionY: 2 });
    const pos = resolvePositions(snap([a]), new Map([[a.id, { x: Number.NaN, y: 5 }]]));
    expect(pos.get(a.id)).toEqual({ x: 1, y: 2 });
  });
  it("la cuadrícula es determinista y no repite posiciones", () => {
    const nodes = ["d", "a", "c", "b", "e"].map((l) => node(l));
    const one = gridLayout(nodes);
    const two = gridLayout([...nodes].reverse());
    expect([...one.entries()].sort()).toEqual([...two.entries()].sort());
    expect(new Set([...one.values()].map((p) => `${p.x},${p.y}`)).size).toBe(nodes.length);
  });
  it("sin ninguna posición, todas se colocan a partir del origen", () => {
    const nodes = [node("a"), node("b")];
    const pos = resolvePositions(snap(nodes));
    expect(pos.size).toBe(2);
  });
  it("bounds, proporción y withPositions", () => {
    const m = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 400, y: 100 }],
    ]);
    expect(boundsOf(m)).toMatchObject({ minX: 0, maxX: 400, width: 400, height: 100 });
    expect(boundsOf(m, 10)).toMatchObject({ width: 420, height: 120 });
    expect(boundsOf(new Map())).toMatchObject({ width: 0, height: 0 });
    expect(contentAspect(m)).toBeGreaterThan(1);
    expect(contentAspect(new Map([["a", { x: 0, y: 0 }]]))).toBe(1);

    const a = node("Ana");
    const doc = snap([a]);
    const out = withPositions(doc, new Map([[a.id, { x: 7, y: 8 }]]));
    expect(out.nodes[0]).toMatchObject({ positionX: 7, positionY: 8 });
    expect(doc.nodes[0]!.positionX).toBeNull(); // no muta el original
  });
});

describe("leyenda", () => {
  it("solo incluye lo que hay en el grafo, con recuentos", () => {
    const p1 = node("Ana");
    const p2 = node("Beto");
    const ph = node("555", {}, "phone");
    const doc = snap([p1, p2, ph], [edge(p1, p2, "recorded"), edge(p1, ph, "recorded"), edge(p2, ph)]);
    const legend = buildLegend(doc);
    expect(legend.types.map((t) => [t.type, t.count]).sort()).toEqual([
      ["person", 2],
      ["phone", 1],
    ]);
    expect(legend.evidence.map((e) => [e.evidence, e.count])).toEqual([
      ["recorded", 2],
      ["hypothesis", 1],
    ]);
    expect(legend.evidence[0]!.dash).toEqual([]);
    expect(legend.evidence[1]!.dash.length).toBeGreaterThan(0);
  });
  it("un grafo vacío da leyenda vacía", () => {
    expect(buildLegend(snap([]))).toEqual({ types: [], evidence: [] });
  });
});
