import { ENTITY_CATALOG, ENTITY_TYPE_IDS } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import { GLYPH_PATHS } from "./glyphs.generated";
import { coverRect, customShapeFor, distanceToPolygon, imageFrameFor, pointInPolygon, rayDistance, SHAPES } from "./shapes";
import type { ZcNode } from "./zoomcharts";

describe("geometría de formas", () => {
  const square = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;

  it("pointInPolygon distingue dentro y fuera", () => {
    expect(pointInPolygon(square, 0, 0)).toBe(true);
    expect(pointInPolygon(square, 0.99, -0.99)).toBe(true);
    expect(pointInPolygon(square, 1.01, 0)).toBe(false);
    expect(pointInPolygon(square, 0, -2)).toBe(false);
  });

  it("distanceToPolygon mide la distancia al borde más cercano", () => {
    expect(distanceToPolygon(square, 3, 0)).toBeCloseTo(2);
    expect(distanceToPolygon(square, 2, 2)).toBeCloseTo(Math.SQRT2);
    expect(distanceToPolygon(square, 0, 0.5)).toBeCloseTo(0.5);
  });

  it("rayDistance da la distancia del centro al borde en una dirección", () => {
    expect(rayDistance(square, 1, 0)).toBeCloseTo(1);
    expect(rayDistance(square, 0, -5)).toBeCloseTo(1);
    expect(rayDistance(square, 1, 1)).toBeCloseTo(Math.SQRT2);
    expect(rayDistance(square, 0, 0)).toBe(0);
  });

  it("el triángulo tiene el borde más cerca abajo que en el vértice superior", () => {
    const tri = SHAPES.triangle.outline;
    expect(rayDistance(tri, 0, -1)).toBeCloseTo(1); // vértice superior
    expect(rayDistance(tri, 0, 1)).toBeCloseTo(0.8); // base
  });

  it.each(Object.entries(SHAPES))("la forma %s contiene su centro y no tiene vértices degenerados", (_name, geo) => {
    expect(pointInPolygon(geo.outline, 0, 0)).toBe(true);
    expect(geo.outline.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of geo.outline) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(y)).toBeLessThanOrEqual(1.0001);
    }
    // Las flechas llegan al borde desde cualquier dirección.
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      expect(rayDistance(geo.outline, Math.cos(rad), Math.sin(rad))).toBeGreaterThan(0.05);
    }
  });

  it("el marcador de ubicación termina en punta hacia abajo", () => {
    const pts = SHAPES.icon_location.outline;
    expect(pts[pts.length - 1]).toEqual([0, 1]);
    expect(pointInPolygon(pts, 0, 0.7)).toBe(true);
    expect(pointInPolygon(pts, 0.6, 0.9)).toBe(false);
  });
});

describe("catálogo ↔ formas ↔ glifos", () => {
  it("cada tipo del catálogo tiene geometría y su icono existe en los glifos generados", () => {
    for (const id of ENTITY_TYPE_IDS) {
      const def = ENTITY_CATALOG[id];
      expect(SHAPES[def.shape], `forma de ${id}`).toBeDefined();
      expect(def.icon, `icono de ${id}`).toBeTruthy();
      expect(GLYPH_PATHS[def.icon ?? ""], `glifo de ${id}`).toBeTruthy();
    }
  });
});

describe("imagen dentro de la forma", () => {
  it("el marco de cada tipo tiene la proporción de su forma y un ancla dentro del contorno", () => {
    for (const id of ENTITY_TYPE_IDS) {
      const frame = imageFrameFor(id);
      const geo = SHAPES[ENTITY_CATALOG[id].shape];
      expect(frame.aspect).toBeCloseTo(geo.hwFactor / geo.hhFactor);
      expect(frame.fit).toBeGreaterThan(0.5);
      expect(frame.fit).toBeLessThanOrEqual(1);
      expect(pointInPolygon(frame.outline, frame.anchor[0], frame.anchor[1]), `${id}: el rostro debe caer dentro de la forma`).toBe(true);
    }
    expect(imageFrameFor("person").aspect).toBe(1);
    expect(imageFrameFor("person").anchor).toEqual([0, 0]);
  });

  it("coverRect cubre siempre el rectángulo del nodo, centrado y sin deformar", () => {
    expect(coverRect(100, 100, 20, 20)).toEqual({ x: -20, y: -20, w: 40, h: 40 });
    const wide = coverRect(200, 100, 20, 20); // más ancha que el marco: se recorta a los lados
    expect(wide.h).toBeCloseTo(40);
    expect(wide.w).toBeCloseTo(80);
    expect(wide.x).toBeCloseTo(-40);
    const tall = coverRect(100, 200, 20, 20);
    expect(tall.w).toBeCloseTo(40);
    expect(tall.h).toBeCloseTo(80);
  });

  const fakeCtx = () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => (prop in target ? target[prop] : (...args: unknown[]) => (calls.push(`${prop}(${args.length})`), prop === "measureText" ? { width: 10 } : undefined)),
      set: (target, prop: string, value) => ((target[prop] = value), true),
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  };
  const loadedImage = (loaded: boolean) => {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: loaded });
    Object.defineProperty(img, "naturalWidth", { value: loaded ? 384 : 0 });
    Object.defineProperty(img, "naturalHeight", { value: loaded ? 384 : 0 });
    return img;
  };

  it("paint dibuja la imagen recortada a la forma cuando está cargada", () => {
    const { ctx, calls } = fakeCtx();
    customShapeFor("person").paint!.call({ label: "Ana" } as unknown as ZcNode, ctx, 0, 0, 28, 28, loadedImage(true), true);
    expect(calls).toContain("clip(0)");
    expect(calls).toContain("drawImage(5)");
  });

  it("sin imagen, con la imagen aún sin cargar o sin detalles, no dibuja ninguna imagen", () => {
    for (const [image, details] of [[undefined, true], [loadedImage(false), true], [loadedImage(true), false]] as const) {
      const { ctx, calls } = fakeCtx();
      customShapeFor("person").paint!.call({ label: "Ana" } as unknown as ZcNode, ctx, 0, 0, 28, 28, image as unknown as HTMLImageElement, details);
      expect(calls).not.toContain("drawImage(5)");
    }
  });
});
