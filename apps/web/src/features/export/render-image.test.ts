import { nodeInputSchema } from "@a-link/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCanvasDark, setCanvasTheme } from "../editor/shapes";
import { dataUriToBytes, renderGraphImage, type RenderRequest } from "./render-image";

/**
 * ZoomCharts simulado: comprueba la ORQUESTACIÓN (ajustes de privacidad, tamaño, limpieza, cancelación). Que la
 * imagen salga bien encuadrada con el SDK real lo comprueba la prueba E2E con licencia.
 */
const state = vi.hoisted(() => ({
  charts: [] as Array<{
    settings: Record<string, unknown>;
    removed: boolean;
    exportArgs: unknown[] | null;
    hostDuringRun: HTMLElement | null;
  }>,
  mode: "ok" as "ok" | "nocanvas" | "throws",
}));

class FakeChart {
  removed = false;
  exportArgs: unknown[] | null = null;
  hostDuringRun: HTMLElement | null;
  constructor(public settings: { container: HTMLElement; events: { onChartUpdate(): void } }) {
    state.charts.push(this);
    this.hostDuringRun = settings.container;
    if (state.mode === "nocanvas") return;
    setTimeout(() => {
      settings.container.appendChild(document.createElement("canvas"));
      settings.events.onChartUpdate();
    }, 0);
  }
  zoom() {
    setTimeout(() => this.settings.events.onChartUpdate(), 0);
  }
  exportAsString(type: string, cb: (uri: string) => void, opts: unknown, transparent: boolean) {
    this.exportArgs = [type, opts, transparent];
    if (state.mode === "throws") throw new Error("boom");
    cb(type === "png" ? "data:image/png;base64,iVBORw0KGgo=" : "data:image/jpeg;base64,/9j/4AAQ");
  }
  remove() {
    this.removed = true;
  }
}

vi.mock("../editor/zoomcharts", () => ({ loadZoomCharts: async () => ({ NetChart: FakeChart }) }));

const node = (label: string) => nodeInputSchema.parse({ id: crypto.randomUUID(), type: "person", label });
const a = node("A");
const b = node("B");
const base = (over: Partial<RenderRequest> = {}): RenderRequest => ({
  doc: { nodes: [a, b], edges: [] },
  positions: new Map([
    [a.id, { x: 0, y: 0 }],
    [b.id, { x: 500, y: 200 }],
  ]),
  width: 1200,
  height: 675,
  scale: 2,
  format: "png",
  background: "white",
  dark: false,
  edgeLabels: true,
  ...over,
});

beforeEach(() => {
  state.charts.length = 0;
  state.mode = "ok";
});
afterEach(() => {
  setCanvasTheme(false);
  document.body.innerHTML = "";
});

describe("dataUriToBytes", () => {
  it("decodifica base64 y devuelve el tipo", () => {
    const r = dataUriToBytes("data:image/png;base64,iVBORw0KGgo=");
    expect(r.mime).toBe("image/png");
    expect([...r.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it("rechaza lo que no es un data-URI", () => {
    expect(() => dataUriToBytes("https://example.com/x.png")).toThrow();
  });
});

describe("renderGraphImage", () => {
  it("exporta en local con el tamaño exacto, sin proxy y con el lienzo auxiliar fuera de pantalla", async () => {
    const img = await renderGraphImage(base());
    const chart = state.charts[0]!;
    const s = chart.settings as { advanced: { exportProxyURL: string }; area: { style: { fillColor: string } }; interaction: { nodesMovable: boolean } };
    expect(s.advanced.exportProxyURL).toBe("about:blank");
    expect(s.area.style.fillColor).toBe("#ffffff");
    expect(s.interaction.nodesMovable).toBe(false);
    expect(chart.exportArgs).toEqual(["png", { width: 1200, height: 675, unit: "px", scaling: 2 }, false]);
    expect(img).toMatchObject({ mime: "image/png", width: 2400, height: 1350 });
    // Se limpia todo.
    expect(chart.removed).toBe(true);
    expect(document.querySelector("[data-export-host]")).toBeNull();
  });

  it("todas las entidades llevan posición fija en los datos enviados al lienzo", async () => {
    await renderGraphImage(base());
    const data = (state.charts[0]!.settings as { data: Array<{ preloaded: { nodes: Array<{ x?: number; y?: number; fixed?: boolean }> } }> }).data[0]!.preloaded.nodes;
    expect(data).toHaveLength(2);
    for (const n of data) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("las etiquetas de relación se envían al lienzo y se quitan si se desactivan (sin tocar el original)", async () => {
    const e = nodeInputSchema.parse({ id: crypto.randomUUID(), type: "person", label: "C" });
    const edge = { id: crypto.randomUUID(), sourceId: a.id, targetId: e.id, relationshipType: "contact" as const, label: "", metadata: { direction: "forward" as const, evidenceClass: "recorded" as const } };
    const doc = { nodes: [a, e], edges: [edge] };
    const positions = new Map([
      [a.id, { x: 0, y: 0 }],
      [e.id, { x: 300, y: 0 }],
    ]);
    type Links = { data: Array<{ preloaded: { links: Array<{ style: { label?: string; lineDash?: number[] } }> } }> };
    await renderGraphImage(base({ doc, positions, edgeLabels: true }));
    expect((state.charts[0]!.settings as Links).data[0]!.preloaded.links[0]!.style.label).toBe("Contacto");
    await renderGraphImage(base({ doc, positions, edgeLabels: false }));
    const off = (state.charts[1]!.settings as Links).data[0]!.preloaded.links[0]!.style;
    expect(off.label).toBeUndefined();
    expect("label" in off).toBe(false);
    expect(edge.label).toBe("");
  });

  it("transparente: sin color de relleno y se pide transparencia; JPEG usa 'jpg'", async () => {
    await renderGraphImage(base({ background: "transparent" }));
    expect((state.charts[0]!.settings as { area?: unknown }).area).toBeUndefined();
    expect(state.charts[0]!.exportArgs![2]).toBe(true);

    const jpg = await renderGraphImage(base({ format: "jpeg" }));
    expect(state.charts[1]!.exportArgs![0]).toBe("jpg");
    expect(jpg.mime).toBe("image/jpeg");
  });

  it("el tema de las etiquetas se aplica durante la exportación y se restaura al terminar", async () => {
    setCanvasTheme(false);
    await renderGraphImage(base({ dark: true, background: "dark" }));
    expect(isCanvasDark()).toBe(false);
    setCanvasTheme(true);
    await renderGraphImage(base({ dark: false }));
    expect(isCanvasDark()).toBe(true);
  });

  it("si el lienzo nunca aparece (licencia inválida) falla con un error y limpia", async () => {
    state.mode = "nocanvas";
    await expect(renderGraphImage(base({ timeoutMs: 150 }))).rejects.toThrow();
    expect(state.charts[0]!.removed).toBe(true);
    expect(document.querySelector("[data-export-host]")).toBeNull();
  });

  it("un fallo del SDK al exportar se propaga y también limpia", async () => {
    state.mode = "throws";
    await expect(renderGraphImage(base())).rejects.toThrow("boom");
    expect(state.charts[0]!.removed).toBe(true);
    expect(document.querySelector("[data-export-host]")).toBeNull();
  });

  it("cancelación: antes de empezar no crea nada; durante la espera aborta y limpia", async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(renderGraphImage(base({ signal: pre.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(state.charts).toHaveLength(0);

    state.mode = "nocanvas";
    const c = new AbortController();
    const p = renderGraphImage(base({ signal: c.signal }));
    await new Promise((r) => setTimeout(r, 30));
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(state.charts[0]!.removed).toBe(true);
    expect(document.querySelector("[data-export-host]")).toBeNull();
  });
});

describe("renderGraphImage · halos", () => {
  type S = { auras?: { enabled: boolean; style: Record<string, unknown> }; data: Array<{ preloaded: { nodes: Array<{ style?: { aura?: string } }> } }> };
  it("sin modo no se configuran halos ni se marcan los nodos", async () => {
    await renderGraphImage(base());
    const s = state.charts[0]!.settings as unknown as S;
    expect(s.auras).toBeUndefined();
    expect(s.data[0]!.preloaded.nodes.every((n) => n.style?.aura === undefined)).toBe(true);
  });
  it("con halos por tipo se envían los ajustes y cada nodo lleva el suyo", async () => {
    await renderGraphImage(base({ auraMode: "type" }));
    const s = state.charts[0]!.settings as unknown as S;
    expect(s.auras?.enabled).toBe(true);
    expect(Object.keys(s.auras!.style)).toEqual(["type:person"]);
    expect(s.data[0]!.preloaded.nodes.every((n) => n.style?.aura === "type:person")).toBe(true);
  });
  it("«none» equivale a no pedirlos", async () => {
    await renderGraphImage(base({ auraMode: "none" }));
    expect((state.charts[0]!.settings as unknown as S).auras).toBeUndefined();
  });
});

describe("renderGraphImage · halos", () => {
  type S = { auras?: { enabled: boolean; style: Record<string, unknown> }; data: Array<{ preloaded: { nodes: Array<{ style?: { aura?: string } }> } }> };
  it("sin modo no se configuran halos ni se marcan los nodos", async () => {
    await renderGraphImage(base());
    const s = state.charts[0]!.settings as unknown as S;
    expect(s.auras).toBeUndefined();
    expect(s.data[0]!.preloaded.nodes.every((n) => n.style?.aura === undefined)).toBe(true);
  });
  it("con halos por tipo se envían los ajustes y cada nodo lleva el suyo", async () => {
    await renderGraphImage(base({ auraMode: "type" }));
    const s = state.charts[0]!.settings as unknown as S;
    expect(s.auras?.enabled).toBe(true);
    expect(Object.keys(s.auras!.style)).toEqual(["type:person"]);
    expect(s.data[0]!.preloaded.nodes.every((n) => n.style?.aura === "type:person")).toBe(true);
  });
  it("«none» equivale a no pedirlos", async () => {
    await renderGraphImage(base({ auraMode: "none" }));
    expect((state.charts[0]!.settings as unknown as S).auras).toBeUndefined();
  });
});