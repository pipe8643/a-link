import type { GraphSnapshot } from "@a-link/shared";
import { DARK_THEME, isCanvasDark, setCanvasTheme } from "../editor/shapes";
import { type AuraMode, auraSettings } from "../editor/auras";
import { type ImageUrlResolver, toZoomData } from "../editor/zoom-data";
import { loadZoomCharts, type ZcNetChart, type ZcSettings } from "../editor/zoomcharts";
import type { Background } from "./export-options";
import { type Positions, withPositions } from "./layout";

export interface RenderRequest {
  doc: GraphSnapshot;
  /** Posición de TODAS las entidades (ver `resolvePositions`). */
  positions: Positions;
  /** Tamaño del lienzo en px CSS y factor de escala (los píxeles finales son tamaño × escala). */
  width: number;
  height: number;
  scale: number;
  format: "png" | "jpeg";
  background: Background;
  /** Etiquetas con texto claro (fondo oscuro) o oscuro (fondo claro/transparente). */
  dark: boolean;
  /** Mostrar la etiqueta de cada relación. */
  edgeLabels: boolean;
  /** Halos que se ven en el editor (por tipo o por etiqueta). Sin indicar, no se dibujan. */
  auraMode?: AuraMode;
  /** URL de la imagen de cada entidad (mismo origen). Sin ella, las entidades se dibujan solo con su icono. */
  imageUrl?: ImageUrlResolver;
  signal?: AbortSignal;
  /** Tiempo máximo total (ms). */
  timeoutMs?: number;
}

export interface RenderedImage {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  /** Píxeles reales de la imagen. */
  width: number;
  height: number;
}

const abortError = () => new DOMException("Exportación cancelada.", "AbortError");

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Decodifica un data-URI base64 sin pasar por `fetch` (no es una petición de red, pero así no depende de la CSP). */
export function dataUriToBytes(uri: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;,]+)(;base64)?,/.exec(uri);
  if (!m) throw new Error("La exportación devolvió un formato inesperado.");
  const payload = uri.slice(m[0].length);
  if (!m[2]) return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime: m[1]! };
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1]! };
}

/** Datos para el lienzo auxiliar: con posiciones fijas y, si se pide, sin etiquetas de relación. */
function exportData(req: RenderRequest) {
  const data = toZoomData(withPositions(req.doc, req.positions), req.auraMode ?? "none", req.imageUrl);
  if (req.edgeLabels) return data;
  return {
    ...data,
    links: data.links.map((l) => {
      const { label: _omit, ...style } = l.style ?? {};
      return { ...l, style };
    }),
  };
}

/** Carga previa de las imágenes de las entidades (mismo origen): así ZoomCharts las encuentra ya en caché al pintar. Las que fallen se ignoran. */
async function preloadImages(urls: readonly string[], maxMs: number): Promise<void> {
  if (urls.length === 0) return;
  const loads = urls.map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = url;
      }),
  );
  await Promise.race([Promise.all(loads), new Promise<void>((r) => setTimeout(r, maxMs))]);
}

/**
 * Dibuja el GRAFO COMPLETO en una instancia de ZoomCharts FUERA DE PANTALLA con las dimensiones exactas de salida,
 * encuadrada con `zoom("overview")`, y devuelve la imagen. No toca el lienzo del usuario (su zoom, selección y
 * posición no cambian) y todo ocurre en local: se usa `exportAsString` (nunca `export`) y el proxy de exportación
 * está anulado (`about:blank`), de modo que los datos del grafo no salen del navegador.
 */
export async function renderGraphImage(req: RenderRequest): Promise<RenderedImage> {
  const { signal, timeoutMs = 30_000 } = req;
  if (signal?.aborted) throw abortError();
  const zc = await loadZoomCharts();
  if (signal?.aborted) throw abortError();

  const imageUrls = req.imageUrl ? new Map(req.doc.nodes.map((n) => [n.id, n.imageId ? req.imageUrl!(n) : undefined] as const)) : new Map<string, string | undefined>();
  await preloadImages([...new Set([...imageUrls.values()].filter((u): u is string => !!u))], 8000);
  if (signal?.aborted) throw abortError();

  const previousDark = isCanvasDark();
  setCanvasTheme(req.dark);

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-export-host", "");
  Object.assign(host.style, {
    position: "fixed",
    top: "0",
    left: "-30000px",
    width: `${req.width}px`,
    height: `${req.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(host);

  let chart: ZcNetChart | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: (() => void) | undefined;

  try {
    const fill = req.background === "white" ? "#ffffff" : req.background === "dark" ? DARK_THEME.background : undefined;
    const settings: ZcSettings = {
      container: host,
      assetsUrlBase: "/zc-assets/",
      advanced: { assets: [], exportProxyURL: "about:blank" },
      credits: { enabled: false },
      toolbar: { enabled: false },
      legend: { enabled: false },
      breadcrumb: { enabled: false },
      nodeMenu: { enabled: false },
      linkMenu: { enabled: false },
      info: { enabled: false },
      ...(fill ? { area: { style: { fillColor: fill } } } : {}),
      ...(req.auraMode && req.auraMode !== "none" ? { auras: auraSettings(req.doc, req.auraMode) } : {}),
      navigation: { mode: "showall" },
      layout: { mode: "dynamic", nodeSpacing: 60, initialLayoutMaxTime: 0 },
      interaction: {
        nodesMovable: false,
        panning: { enabled: false },
        zooming: { wheel: false, fingers: false, zoomExtent: [0.005, 4], autoZoomExtent: [0.005, 1] },
        selection: { enabled: false },
        resizing: { enabled: false },
      },
      style: {
        linkLabel: { textStyle: { font: "12px ui-sans-serif, system-ui, sans-serif" } },
        nodeStyleFunction: (node) => {
          node.image = imageUrls.get(node.id) ?? undefined;
        },
      },
      // Todas las entidades llevan posición fija: lo exportado coincide con lo que se ve en el editor.
      data: [{ preloaded: exportData(req) }],
    };

    let updates = 0;
    settings.events = { onChartUpdate: () => void (updates += 1) };
    chart = new zc.NetChart(settings);

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("La exportación tardó demasiado y se canceló.")), timeoutMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => signal?.removeEventListener("abort", onAbort);
    });
    const guard = <T>(p: Promise<T>) => Promise.race([p, deadline, aborted]);

    const waitFor = async (cond: () => boolean, what: string, maxMs: number) => {
      const start = performance.now();
      while (!cond()) {
        if (performance.now() - start > maxMs) throw new Error(what);
        await nextFrame();
      }
    };

    // 1) Con una licencia ausente o inválida ZoomCharts no lanza: deja un objeto sin <canvas>.
    await guard(waitFor(() => !!host.querySelector("canvas"), "ZoomCharts no inicializó el lienzo (¿licencia ausente o inválida?).", 8000));
    // 2) Primer pintado con todos los datos.
    await guard(waitFor(() => updates > 0, "El lienzo de exportación no terminó de pintarse.", 8000));

    // 3) Encuadre del grafo completo y espera a que se repinte.
    const before = updates;
    chart.zoom("overview", false);
    await guard(waitFor(() => updates > before, "El lienzo de exportación no terminó de encuadrarse.", 4000).catch(() => undefined));
    // Las imágenes de las entidades llegan de forma asíncrona: se da un margen para que se pinten antes de capturar.
    if (imageUrls.size > 0 && [...imageUrls.values()].some(Boolean)) {
      const settled = updates;
      chart.updateStyle();
      await guard(waitFor(() => updates > settled, "", 1500).catch(() => undefined));
      await guard(new Promise<void>((r) => setTimeout(r, 400)));
    }
    await guard(nextFrame());
    await guard(nextFrame());

    // 4) Exportación en local.
    const transparent = req.background === "transparent";
    const type = req.format === "png" ? "png" : "jpg";
    const dataUri = await guard(
      new Promise<string>((resolve, reject) => {
        try {
          chart!.exportAsString(type, (uri) => resolve(uri), { width: req.width, height: req.height, unit: "px", scaling: req.scale }, transparent);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("No se pudo generar la imagen."));
        }
      }),
    );
    const { bytes, mime } = dataUriToBytes(dataUri);
    return {
      bytes,
      mime: mime === "image/jpeg" ? "image/jpeg" : "image/png",
      width: req.width * req.scale,
      height: req.height * req.scale,
    };
  } finally {
    if (timer) clearTimeout(timer);
    removeAbort?.();
    try {
      chart?.remove();
    } catch {
      /* ya liberado */
    }
    host.remove();
    setCanvasTheme(previousDark);
  }
}
