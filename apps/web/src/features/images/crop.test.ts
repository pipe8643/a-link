import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_IDS } from "@a-link/shared";
import { imageFrameFor } from "../editor/shapes";
import { MAX_ZOOM, MIN_ZOOM, centeredCrop, clampState, cropForFace, cropRect, outputSize, panCrop, pickMainFace, scaleBox, zoomCrop, type Box, type Size } from "./crop";

const inside = (r: Box, src: Size) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.width <= src.width + 1e-9 && r.y + r.height <= src.height + 1e-9;
const circle = { aspect: 1, anchor: [0, 0] as const, fit: 1 };

describe("recorte de la imagen de una entidad", () => {
  it("el recorte centrado es el mayor rectángulo con la proporción de la forma, centrado", () => {
    const src = { width: 400, height: 300 };
    expect(cropRect(src, 1, centeredCrop(src, 1))).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    const wide = cropRect(src, 1.5, centeredCrop(src, 1.5)); // rectángulo redondeado: 1,5:1
    expect(wide.width / wide.height).toBeCloseTo(1.5);
    expect(wide.width).toBeCloseTo(400);
    const tall = cropRect({ width: 300, height: 500 }, 0.82, centeredCrop({ width: 300, height: 500 }, 0.82)); // documento
    expect(tall.width / tall.height).toBeCloseTo(0.82);
    expect(tall.width).toBeCloseTo(300);
  });

  it("cualquier estado (incluso absurdo) se sujeta para que el recorte quede dentro de la imagen", () => {
    const src = { width: 640, height: 480 };
    for (const aspect of [0.82, 1, 1.5]) {
      for (const state of [
        { cx: -5000, cy: 9999, zoom: 3 },
        { cx: 0, cy: 0, zoom: 0.1 },
        { cx: 320, cy: 240, zoom: 1000 },
        { cx: NaN, cy: Infinity, zoom: NaN },
      ]) {
        const r = cropRect(src, aspect, state);
        expect(inside(r, src), JSON.stringify(state)).toBe(true);
        expect(r.width / r.height).toBeCloseTo(aspect);
        const c = clampState(src, aspect, state);
        expect(c.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
        expect(c.zoom).toBeLessThanOrEqual(MAX_ZOOM);
      }
    }
  });

  it("con un rostro, el recorte lo deja centrado y con un tamaño razonable (círculo)", () => {
    const src = { width: 1000, height: 1000 };
    const face = { x: 450, y: 350, width: 100, height: 120 }; // centro (500, 410)
    const state = cropForFace(src, face, circle);
    const r = cropRect(src, 1, state);
    expect(inside(r, src)).toBe(true);
    expect(r.x + r.width / 2).toBeCloseTo(500);
    expect(r.y + r.height / 2).toBeCloseTo(410);
    expect(r.width).toBeCloseTo(240); // 120 / 0,5
    // El rostro cae completo dentro del recorte.
    expect(face.x).toBeGreaterThanOrEqual(r.x);
    expect(face.x + face.width).toBeLessThanOrEqual(r.x + r.width);
    expect(face.y).toBeGreaterThanOrEqual(r.y);
    expect(face.y + face.height).toBeLessThanOrEqual(r.y + r.height);
  });

  it("un rostro pegado al borde mantiene el recorte dentro de la imagen y el rostro visible", () => {
    const src = { width: 800, height: 600 };
    for (const face of [
      { x: 0, y: 0, width: 80, height: 90 },
      { x: 720, y: 510, width: 80, height: 90 },
      { x: 0, y: 250, width: 80, height: 90 },
    ]) {
      const r = cropRect(src, 1, cropForFace(src, face, circle));
      expect(inside(r, src)).toBe(true);
      expect(face.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(face.x + face.width).toBeLessThanOrEqual(r.x + r.width + 1e-6);
      expect(face.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(face.y + face.height).toBeLessThanOrEqual(r.y + r.height + 1e-6);
    }
  });

  it("un rostro que llena la foto produce el recorte máximo, nunca más pequeño que el rostro", () => {
    const src = { width: 500, height: 500 };
    const face = { x: 20, y: 10, width: 460, height: 470 };
    const r = cropRect(src, 1, cropForFace(src, face, circle));
    expect(r.width).toBeCloseTo(500);
  });

  it("para cada tipo de entidad el rostro cae dentro del recorte y respeta la proporción de su forma", () => {
    const src = { width: 900, height: 1200 };
    const face = { x: 350, y: 300, width: 200, height: 240 };
    for (const id of ENTITY_TYPE_IDS) {
      const frame = imageFrameFor(id);
      const r = cropRect(src, frame.aspect, cropForFace(src, face, frame));
      expect(inside(r, src), id).toBe(true);
      expect(r.width / r.height, id).toBeCloseTo(frame.aspect);
      expect(face.x, id).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(face.x + face.width, id).toBeLessThanOrEqual(r.x + r.width + 1e-6);
      expect(face.y, id).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(face.y + face.height, id).toBeLessThanOrEqual(r.y + r.height + 1e-6);
    }
  });

  it("las formas estrechas (triángulo, rombo, marcador) dejan más margen alrededor del rostro que el círculo", () => {
    const src = { width: 1000, height: 1000 };
    const face = { x: 450, y: 450, width: 100, height: 100 };
    const circleW = cropRect(src, 1, cropForFace(src, face, imageFrameFor("person"))).width;
    const pinW = cropRect(src, 1, cropForFace(src, face, { ...imageFrameFor("location"), aspect: 1 })).width;
    expect(pinW).toBeGreaterThan(circleW);
  });

  it("arrastrar la imagen mueve el recorte en sentido contrario y nunca lo saca de la imagen", () => {
    const src = { width: 800, height: 800 };
    const start = { cx: 400, cy: 400, zoom: 2 }; // recorte de 400 px
    const moved = cropRect(src, 1, panCrop(src, 1, start, 50, -20, 200)); // 200 px de vista: 2 px de origen por px de pantalla
    expect(moved.x + moved.width / 2).toBeCloseTo(300);
    expect(moved.y + moved.height / 2).toBeCloseTo(440);
    const far = cropRect(src, 1, panCrop(src, 1, start, -99999, 99999, 200));
    expect(inside(far, src)).toBe(true);
  });

  it("cambiar el zoom conserva el centro; sin zoom el recorte vuelve a ser el máximo", () => {
    const src = { width: 800, height: 600 };
    const base = { cx: 300, cy: 300, zoom: 2 };
    const zoomed = cropRect(src, 1, zoomCrop(src, 1, base, 4));
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(300);
    expect(zoomed.width).toBeCloseTo(150);
    const reset = cropRect(src, 1, zoomCrop(src, 1, base, 1));
    expect(reset.width).toBeCloseTo(600);
    expect(inside(reset, src)).toBe(true);
  });

  it("el tamaño de salida respeta la proporción y el lado mayor", () => {
    expect(outputSize(1, 384)).toEqual({ width: 384, height: 384 });
    expect(outputSize(1.5, 384)).toEqual({ width: 384, height: 256 });
    expect(outputSize(0.82, 384)).toEqual({ width: 315, height: 384 });
  });

  it("pickMainFace elige el rostro mayor, cuenta los válidos e ignora cajas inválidas", () => {
    expect(pickMainFace([])).toEqual({ face: null, count: 0 });
    const small = { x: 0, y: 0, width: 10, height: 10 };
    const big = { x: 5, y: 5, width: 40, height: 50 };
    expect(pickMainFace([small, big])).toEqual({ face: big, count: 2 });
    expect(pickMainFace([{ x: NaN, y: 0, width: 5, height: 5 }, { x: 0, y: 0, width: 0, height: 4 }])).toEqual({ face: null, count: 0 });
  });

  it("scaleBox devuelve la caja a las dimensiones originales", () => {
    expect(scaleBox({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({ x: 20, y: 40, width: 60, height: 80 });
  });
});
