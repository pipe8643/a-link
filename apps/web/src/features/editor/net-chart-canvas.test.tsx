import type { GraphSnapshot } from "@a-link/shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNode } from "./editor-commands";
import { NetChartCanvas, type NetChartCanvasHandle } from "./net-chart-canvas";

/**
 * ZoomCharts simulado. Reproduce el comportamiento REAL observado en el navegador cuando la licencia no se
 * valida: el <canvas> aparece y, más tarde, el objeto interno se destruye y cualquier llamada lanza
 * `TypeError: Cannot read properties of null (reading 'requestPaint')`.
 */
const state = vi.hoisted(() => ({ instances: [] as unknown[], loader: undefined as undefined | (() => Promise<unknown>) }));

class FakeChart {
  removed = false;
  broken = false;
  selected: string[] = [];
  nodeIds = new Set<string>();
  linkIds = new Set<string>();
  calls: string[] = [];
  events: Record<string, (...a: unknown[]) => void>;
  canvas = document.createElement("canvas");

  constructor(public settings: { container: HTMLElement; auras?: unknown; data: Array<{ preloaded: { nodes: Array<{ id: string; x?: number; y?: number }>; links: Array<{ id: string }> } }>; events: Record<string, (...a: unknown[]) => void> }) {
    state.instances.push(this);
    this.events = settings.events;
    settings.container.appendChild(this.canvas);
    for (const n of settings.data[0]!.preloaded.nodes) {
      this.nodeIds.add(n.id);
      this.place(n);
    }
    for (const l of settings.data[0]!.preloaded.links) this.linkIds.add(l.id);
  }
  private guard() {
    if (this.broken || this.removed) throw new TypeError("Cannot read properties of null (reading 'requestPaint')");
  }
  /** Posición «actual» de cada nodo (la del dato si la trae; si no, una calculada como haría el diseño automático). */
  positions = new Map<string, { x: number; y: number }>();
  /** Nodos tal y como se enviaron en cada `addData` (para comprobar posición, bloqueo y halo). */
  added: Array<Array<{ id: string; x?: number; y?: number; locked?: boolean; style?: { aura?: string } }>> = [];
  settingsUpdates: Array<Record<string, unknown>> = [];
  private place(n: { id: string; x?: number; y?: number }) {
    if (typeof n.x === "number" && typeof n.y === "number") this.positions.set(n.id, { x: n.x, y: n.y });
    else if (!this.positions.has(n.id)) this.positions.set(n.id, { x: 100 + this.positions.size * 10, y: 200 + this.positions.size });
  }
  getNodeDimensions(n: { id: string }) {
    this.guard();
    const p = this.positions.get(n.id) ?? { x: 0, y: 0 };
    return { ...p, radius: 28, hwidth: 28 };
  }
  updateSettings(s: Record<string, unknown>) {
    this.guard();
    this.calls.push("updateSettings");
    this.settingsUpdates.push(s);
    return this;
  }
  addData(d: { nodes: Array<{ id: string; x?: number; y?: number; locked?: boolean; style?: { aura?: string } }>; links: Array<{ id: string }> }) {
    this.guard();
    this.calls.push(`addData:${d.nodes.length}:${d.links.length}`);
    this.added.push(d.nodes);
    d.nodes.forEach((n) => {
      this.nodeIds.add(n.id);
      this.place(n);
    });
    d.links.forEach((l) => this.linkIds.add(l.id));
  }
  removeData(d: { nodes: Array<{ id: string }>; links: Array<{ id: string }> }) {
    this.guard();
    this.calls.push(`removeData:${d.nodes.length}:${d.links.length}`);
    d.nodes.forEach((n) => {
      this.nodeIds.delete(n.id);
      this.positions.delete(n.id);
    });
    d.links.forEach((l) => this.linkIds.delete(l.id));
  }
  updateStyle() {
    this.guard();
  }
  updateSize() {
    this.guard();
    return this;
  }
  getNode(id: string) {
    this.guard();
    return this.nodeIds.has(id) ? { id } : null;
  }
  getLink(id: string) {
    this.guard();
    return this.linkIds.has(id) ? { id } : null;
  }
  selection(s?: string[]) {
    this.guard();
    if (s) this.selected = s;
    return this.selected.map((id) => ({ id }));
  }
  nodes(): unknown[] {
    this.guard();
    return [];
  }
  zooms: Array<number | string | undefined> = [];
  zoom(value?: number | string) {
    this.guard();
    this.zooms.push(value);
  }
  scrollIntoView() {
    this.guard();
  }
  unlockNode() {
    this.guard();
  }
  resetLayout() {
    this.guard();
  }
  remove() {
    if (this.removed) throw new Error("Removing already removed chart");
    this.removed = true;
    this.canvas.remove();
  }
}

vi.mock("./zoomcharts", () => ({ loadZoomCharts: () => state.loader!() }));

const charts = () => state.instances as FakeChart[];

function makeDoc(count = 2): GraphSnapshot {
  const nodes = Array.from({ length: count }, () => {
    const r = buildNode("person", []);
    if (!r.ok) throw new Error("no se pudo crear");
    return { ...r.value, label: `N-${Math.random().toString(36).slice(2, 6)}` };
  });
  return { nodes, edges: [] };
}

const NONE: { nodeIds: string[]; edgeIds: string[] } = { nodeIds: [], edgeIds: [] };
const status = () => screen.getByTestId("net-chart").getAttribute("data-status");

beforeEach(() => {
  state.instances = [];
  state.loader = () => Promise.resolve({ NetChart: FakeChart });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

async function mount(doc = makeDoc(), extra: Partial<Parameters<typeof NetChartCanvas>[0]> = {}) {
  const ui = (d: GraphSnapshot, sel = NONE) => (
    <NetChartCanvas doc={d} selection={sel} dark={false} onSelectionChange={() => undefined} {...extra} />
  );
  const view = render(ui(doc));
  await waitFor(() => expect(status()).toBe("ready"));
  return { view, ui, chart: () => charts().at(-1)! };
}

describe("NetChartCanvas · arrastre", () => {
  it("readOnly impide mover nodos; nodesMovable lo habilita en el visor compartido", async () => {
    const locked = await mount(makeDoc(), { readOnly: true });
    expect(((locked.chart().settings as unknown) as { interaction: { nodesMovable: boolean } }).interaction.nodesMovable).toBe(false);
    locked.view.unmount();
    const live = await mount(makeDoc(), { readOnly: true, nodesMovable: true });
    expect(((live.chart().settings as unknown) as { interaction: { nodesMovable: boolean } }).interaction.nodesMovable).toBe(true);
  });
});

describe("NetChartCanvas · ciclo de vida", () => {
  it("monta, pinta un canvas y lo libera al desmontar, sin fugas tras montajes repetidos", async () => {
    for (let i = 0; i < 6; i++) {
      const { view } = await mount();
      expect(document.querySelectorAll("canvas")).toHaveLength(1);
      view.unmount();
      expect(document.querySelectorAll("canvas")).toHaveLength(0);
    }
    expect(charts()).toHaveLength(6);
    expect(charts().every((c) => c.removed)).toBe(true);
  });

  it("si se desmonta antes de terminar la carga, no se crea ningún lienzo", async () => {
    let resolve!: (v: unknown) => void;
    state.loader = () => new Promise((r) => (resolve = r));
    const { unmount } = render(<NetChartCanvas doc={makeDoc()} selection={NONE} dark={false} onSelectionChange={() => undefined} />);
    unmount();
    await act(async () => resolve({ NetChart: FakeChart }));
    expect(charts()).toHaveLength(0);
  });

  it("un fallo al cargar la librería deja el estado en error y permite reintentar", async () => {
    const onError = vi.fn();
    state.loader = () => Promise.reject(new Error("sin red"));
    render(<NetChartCanvas doc={makeDoc()} selection={NONE} dark={false} onSelectionChange={() => undefined} onError={onError} />);
    await waitFor(() => expect(status()).toBe("error"));
    expect(onError).toHaveBeenCalled();
    state.loader = () => Promise.resolve({ NetChart: FakeChart });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(status()).toBe("ready"));
  });

  it("si ZoomCharts destruye su objeto tras estar listo, el lienzo pasa a error SIN lanzar al resto de la aplicación", async () => {
    const onStatus = vi.fn();
    const { view, ui, chart } = await mount(makeDoc(1), { onStatusChange: onStatus });
    chart().broken = true; // licencia rechazada de forma asíncrona
    // Cambiar el documento, la selección y el tema ejecuta updateStyle/selection sobre el objeto roto.
    expect(() => view.rerender(ui(makeDoc(3), { nodeIds: [], edgeIds: [] }))).not.toThrow();
    await waitFor(() => expect(status()).toBe("error"));
    expect(onStatus).toHaveBeenLastCalledWith("error");
    expect(chart().removed).toBe(true);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("sin <canvas> tras 3 s se considera licencia ausente/inválida y pasa a error", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const NoCanvas = class extends FakeChart {
        constructor(s: ConstructorParameters<typeof FakeChart>[0]) {
          super(s);
          this.canvas.remove();
        }
      };
      state.loader = () => Promise.resolve({ NetChart: NoCanvas });
      render(<NetChartCanvas doc={makeDoc()} selection={NONE} dark={false} onSelectionChange={() => undefined} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(status()).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NetChartCanvas · sincronización con el documento", () => {
  it("solo envía diferencias: añade lo nuevo y elimina lo borrado", async () => {
    const doc = makeDoc(2);
    const { view, ui, chart } = await mount(doc);
    const extra = makeDoc(1).nodes[0]!;

    view.rerender(ui({ nodes: [...doc.nodes, extra], edges: [] }));
    expect(chart().calls).toEqual(["addData:1:0"]);
    expect(chart().nodeIds.has(extra.id)).toBe(true);

    view.rerender(ui({ nodes: doc.nodes, edges: [] }));
    expect(chart().calls).toEqual(["addData:1:0", "removeData:1:0"]);
    expect(chart().nodeIds.has(extra.id)).toBe(false);
  });

  it("un renombrado reenvía únicamente el nodo modificado", async () => {
    const doc = makeDoc(3);
    const { view, ui, chart } = await mount(doc);
    const renamed = { ...doc.nodes[1]!, label: "Renombrado" };
    view.rerender(ui({ nodes: [doc.nodes[0]!, renamed, doc.nodes[2]!], edges: [] }));
    expect(chart().calls).toEqual(["addData:1:0"]);
  });
});

describe("NetChartCanvas · selección", () => {
  it("aplica al lienzo la selección de React", async () => {
    const doc = makeDoc(2);
    const { view, ui, chart } = await mount(doc);
    view.rerender(ui(doc, { nodeIds: [doc.nodes[1]!.id], edgeIds: [] }));
    expect(chart().selected).toEqual([doc.nodes[1]!.id]);
  });

  it("ignora los cambios de selección que no nacen de un gesto del usuario (React es la fuente de verdad)", async () => {
    const doc = makeDoc(2);
    const onSelectionChange = vi.fn();
    const { view, ui, chart } = await mount(doc, { onSelectionChange });
    view.rerender(ui(doc, { nodeIds: [doc.nodes[0]!.id], edgeIds: [] }));
    // ZoomCharts notifica (de forma asíncrona) un estado vacío: no debe borrar la selección de React.
    chart().selected = [];
    chart().events.onSelectionChange!({}, {});
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("propaga la selección hecha con el ratón y separa nodos de relaciones", async () => {
    const doc = makeDoc(2);
    const onSelectionChange = vi.fn();
    const { chart } = await mount(doc, { onSelectionChange });
    chart().events.onPointerDown!({}, {});
    chart().selected = [doc.nodes[0]!.id, "edge-desconocido"];
    chart().events.onSelectionChange!({}, {});
    chart().events.onPointerUp!({}, {});
    expect(onSelectionChange).toHaveBeenCalledWith({ nodeIds: [doc.nodes[0]!.id], edgeIds: ["edge-desconocido"] });
  });

  it("si el nodo seleccionado aún no existe en el lienzo, la selección se completa en el siguiente chartUpdate", async () => {
    const doc = makeDoc(1);
    const { view, ui, chart } = await mount(doc);
    const fresh = makeDoc(1).nodes[0]!;
    // Simula addData asíncrono: el nodo se registra en el lienzo después de la llamada.
    const original = chart().addData.bind(chart());
    chart().addData = (d) => {
      chart().calls.push("addData(diferido)");
      setTimeout(() => original(d), 0);
    };
    view.rerender(ui({ nodes: [...doc.nodes, fresh], edges: [] }, { nodeIds: [fresh.id], edgeIds: [] }));
    expect(chart().selected).toEqual([]); // todavía no existe
    await new Promise((r) => setTimeout(r, 5));
    act(() => chart().events.onChartUpdate!({}, {}));
    expect(chart().selected).toEqual([fresh.id]);
  });
});

describe("NetChartCanvas · gestos", () => {
  it("al soltar tras arrastrar, informa de las posiciones de los nodos movidos", async () => {
    const doc = makeDoc(2);
    const onNodesMoved = vi.fn();
    const { chart } = await mount(doc, { onNodesMoved });
    const c = chart() as FakeChart & { getNodeDimensions: (n: unknown) => unknown };
    c.nodes = () => [{ id: doc.nodes[0]!.id, userLock: true }, { id: doc.nodes[1]!.id, userLock: false }];
    c.getNodeDimensions = () => ({ x: 12.345, y: -7.891, radius: 28, hwidth: 28 });
    c.events.onPointerDown!({}, {});
    c.events.onPointerUp!({}, {});
    expect(onNodesMoved).toHaveBeenCalledWith([{ id: doc.nodes[0]!.id, x: 12.35, y: -7.89 }]);
  });

  it("los comandos de la barra no fallan aunque el lienzo esté roto", async () => {
    const ref = createRef<NetChartCanvasHandle>();
    const doc = makeDoc(1);
    render(<NetChartCanvas ref={ref} doc={doc} selection={NONE} dark={false} onSelectionChange={() => undefined} />);
    await waitFor(() => expect(status()).toBe("ready"));
    charts()[0]!.broken = true;
    expect(() => {
      ref.current!.zoomBy(1.4);
      ref.current!.fit();
      ref.current!.reorganize();
    }).not.toThrow();
    await waitFor(() => expect(status()).toBe("error"));
  });
});

describe("NetChartCanvas · vista (ocultar/mostrar), halos y doble clic", () => {
  it("una entidad que se oculta y vuelve a mostrarse reaparece donde estaba (si el documento no guarda posición)", async () => {
    const doc = makeDoc(3);
    const [a, b] = [doc.nodes[0]!, doc.nodes[1]!];
    const { view, ui, chart } = await mount(doc);
    const where = { ...chart().positions.get(b.id)! };

    view.rerender(ui({ nodes: doc.nodes.filter((n) => n.id !== b.id), edges: [] }));
    expect(chart().calls).toContain("removeData:1:0");
    view.rerender(ui(doc));
    const resent = chart().added.at(-1)!.find((n) => n.id === b.id)!;
    expect(resent).toMatchObject({ x: where.x, y: where.y, locked: true });
    // La que nunca se ocultó no se reenvía ni se fija.
    expect(chart().added.at(-1)!.some((n) => n.id === a.id)).toBe(false);
  });

  it("si el documento guarda posición propia, esa manda sobre la recordada", async () => {
    const doc = makeDoc(2);
    const b = doc.nodes[1]!;
    const { view, ui, chart } = await mount(doc);
    view.rerender(ui({ nodes: [doc.nodes[0]!], edges: [] }));
    const moved = { ...b, positionX: 7, positionY: 9 };
    view.rerender(ui({ nodes: [doc.nodes[0]!, moved], edges: [] }));
    expect(chart().added.at(-1)!.find((n) => n.id === b.id)).toMatchObject({ x: 7, y: 9 });
  });

  it("una entidad nueva (nunca vista) no recibe posición inventada", async () => {
    const doc = makeDoc(1);
    const { view, ui, chart } = await mount(doc);
    const fresh = makeDoc(1).nodes[0]!;
    view.rerender(ui({ nodes: [...doc.nodes, fresh], edges: [] }));
    const sent = chart().added.at(-1)!.find((n) => n.id === fresh.id)!;
    expect(sent.x).toBeUndefined();
    expect(sent.locked).toBeUndefined();
  });

  it("si leer la posición falla, igualmente se retiran los datos", async () => {
    const doc = makeDoc(2);
    const { view, ui, chart } = await mount(doc);
    chart().getNodeDimensions = () => {
      throw new Error("sin dimensiones");
    };
    view.rerender(ui({ nodes: [doc.nodes[0]!], edges: [] }));
    expect(chart().calls).toContain("removeData:1:0");
    expect(status()).toBe("ready");
  });

  it("sin halos NO se pasa la clave `auras` (con `enabled:false` ZoomCharts desplaza la detección del ratón)", async () => {
    const { chart } = await mount(makeDoc(2));
    expect("auras" in (chart().settings as object)).toBe(false);
    // Volver a «sin halos» tras haberlos usado sí lo comunica al lienzo.
  });
  it("halos: con el modo inicial van en los datos y los ajustes, sin reenviar nada al montar", async () => {
    const doc = makeDoc(2);
    const { chart } = await mount(doc, { auraMode: "type" });
    const s = chart().settings as { auras: { enabled: boolean; style: Record<string, unknown> } };
    expect(s.auras.enabled).toBe(true);
    expect(Object.keys(s.auras.style)).toEqual(["type:person"]);
    expect(chart().calls).toEqual([]);
  });

  it("halos: cambiar el modo actualiza los ajustes y reenvía los nodos con su halo una sola vez", async () => {
    const doc = makeDoc(2);
    const { view, chart } = await mount(doc);
    expect(chart().calls).toEqual([]);
    const withMode = (mode: "none" | "type" | "tag") => (
      <NetChartCanvas doc={doc} selection={NONE} dark={false} auraMode={mode} onSelectionChange={() => undefined} />
    );
    view.rerender(withMode("type"));
    expect(chart().calls).toEqual(["updateSettings", "addData:2:0"]);
    expect((chart().settingsUpdates[0] as { auras: { enabled: boolean } }).auras.enabled).toBe(true);
    expect(chart().added[0]!.every((n) => n.style?.aura === "type:person")).toBe(true);

    view.rerender(withMode("type")); // mismo modo: nada
    expect(chart().calls).toHaveLength(2);

    view.rerender(withMode("none"));
    expect((chart().settingsUpdates[1] as { auras: { enabled: boolean } }).auras.enabled).toBe(false);
    expect(chart().added[1]!.every((n) => n.style?.aura === undefined)).toBe(true);
  });

  it("halos por etiqueta: una etiqueta nueva añade su estilo al lienzo", async () => {
    const doc = makeDoc(2);
    const tagged = (tag: string) => ({ nodes: [{ ...doc.nodes[0]!, tags: [tag] }, doc.nodes[1]!], edges: [] });
    const { view, chart } = await mount(tagged("Norte"), { auraMode: "tag" });
    const ui = (d: GraphSnapshot) => <NetChartCanvas doc={d} selection={NONE} dark={false} auraMode="tag" onSelectionChange={() => undefined} />;
    view.rerender(ui(tagged("Sur")));
    expect(chart().calls).toContain("updateSettings");
    const styles = (chart().settingsUpdates.at(-1) as { auras: { style: Record<string, unknown> } }).auras.style;
    expect(Object.keys(styles)).toEqual(["tag:sur"]);
    expect(chart().added.at(-1)![0]!.style?.aura).toBe("tag:sur");
  });

  it("doble clic sobre una entidad avisa con su id; sobre el fondo no", async () => {
    const onNodeDoubleClick = vi.fn();
    const doc = makeDoc(1);
    const { chart } = await mount(doc, { onNodeDoubleClick });
    chart().events.onDoubleClick!({}, { clickNode: { id: doc.nodes[0]!.id } });
    chart().events.onDoubleClick!({}, {});
    expect(onNodeDoubleClick).toHaveBeenCalledTimes(1);
    expect(onNodeDoubleClick).toHaveBeenCalledWith(doc.nodes[0]!.id);
  });
});

describe("NetChartCanvas · «Ajustar a la vista»", () => {
  it("vuelve al encuadre automático de todo lo que se ve (zoom «overview»)", async () => {
    const ref = createRef<NetChartCanvasHandle>();
    render(<NetChartCanvas ref={ref} doc={makeDoc(2)} selection={NONE} dark={false} onSelectionChange={() => undefined} />);
    await waitFor(() => expect(status()).toBe("ready"));
    ref.current!.fit();
    expect(charts()[0]!.zooms).toEqual(["overview"]);
  });
});