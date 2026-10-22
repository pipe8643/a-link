import { randomUUID } from "node:crypto";
import { nodeInputSchema, type GraphNodeData } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import { AURA_PALETTE, auraGroups, auraIdOf, auraSettings, colorForTag } from "./auras";
import { toZoomNode } from "./zoom-data";

const node = (label: string, type = "person", tags: string[] = []): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label, tags });

describe("auraIdOf", () => {
  it("por tipo: uno por tipo de entidad", () => {
    expect(auraIdOf(node("a", "phone"), "type")).toBe("type:phone");
  });
  it("por etiqueta: la primera etiqueta, sin distinguir mayúsculas ni espacios; sin etiquetas, sin halo", () => {
    expect(auraIdOf(node("a", "person", ["  Norte ", "Sur"]), "tag")).toBe("tag:norte");
    expect(auraIdOf(node("a", "person", ["NORTE"]), "tag")).toBe("tag:norte");
    expect(auraIdOf(node("a"), "tag")).toBeUndefined();
  });
  it("sin halos: nunca", () => {
    expect(auraIdOf(node("a", "person", ["x"]), "none")).toBeUndefined();
  });
});

describe("auraGroups y ajustes", () => {
  const doc = { nodes: [node("a", "person", ["Norte"]), node("b", "person", ["norte"]), node("c", "phone", ["Sur"]), node("d", "phone")], edges: [] };

  it("agrupa por tipo con el color del tipo y cuenta", () => {
    const g = auraGroups(doc, "type");
    expect(g.map((x) => [x.id, x.count])).toEqual([
      ["type:person", 2],
      ["type:phone", 2],
    ]);
    expect(g[0]!.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("agrupa por etiqueta (juntando variantes de mayúsculas) y omite las entidades sin etiqueta", () => {
    const g = auraGroups(doc, "tag");
    expect(g.map((x) => [x.id, x.count])).toEqual([
      ["tag:norte", 2],
      ["tag:sur", 1],
    ]);
  });

  it("ajustes: desactivados sin halos; con halos, solo los definidos (defaultColors vacío) y sin leyenda del SDK", () => {
    expect(auraSettings(doc, "none")).toEqual({ enabled: false });
    const s = auraSettings(doc, "tag") as { enabled: boolean; defaultColors: string[]; style: Record<string, { fillColor: string; showInLegend: boolean }> };
    expect(s.enabled).toBe(true);
    expect(s.defaultColors).toEqual([]);
    expect(Object.keys(s.style)).toEqual(["tag:norte", "tag:sur"]);
    expect(s.style["tag:norte"]!.fillColor).toMatch(/^rgba\(\d+,\d+,\d+,0\.16\)$/);
    expect(s.style["tag:norte"]!.showInLegend).toBe(false);
  });

  it("el color de una etiqueta es estable y no depende de las demás", () => {
    expect(colorForTag("Norte")).toBe(colorForTag(" norte "));
    expect(AURA_PALETTE).toContain(colorForTag("cualquier cosa"));
    const alone = auraGroups({ nodes: [node("a", "person", ["Norte"])], edges: [] }, "tag")[0]!.color;
    expect(auraGroups(doc, "tag")[0]!.color).toBe(alone);
  });
});

describe("toZoomNode y halos", () => {
  it("el halo viaja en el estilo del nodo solo si hay modo y grupo", () => {
    const n = node("a", "person", ["Norte"]);
    expect(toZoomNode(n).style?.aura).toBeUndefined();
    expect(toZoomNode(n, "type").style?.aura).toBe("type:person");
    expect(toZoomNode(n, "tag").style?.aura).toBe("tag:norte");
    expect(toZoomNode(node("b"), "tag").style?.aura).toBeUndefined();
  });
  it("posición: la guardada manda; si no, la recordada; si no, ninguna", () => {
    const n = node("a");
    expect(toZoomNode(n)).not.toHaveProperty("x");
    expect(toZoomNode(n, "none", { x: 1, y: 2 })).toMatchObject({ x: 1, y: 2, locked: true });
    expect(toZoomNode({ ...n, positionX: 5, positionY: 6 }, "none", { x: 1, y: 2 })).toMatchObject({ x: 5, y: 6, locked: true });
  });
});
