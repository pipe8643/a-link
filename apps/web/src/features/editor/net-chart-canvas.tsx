import type { GraphSnapshot } from "@a-link/shared";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type AuraMode, auraSettings } from "./auras";
import { setCanvasTheme } from "./shapes";
import { type ImageUrlResolver, toZoomData, toZoomLink, toZoomNode } from "./zoom-data";
import { loadZoomCharts, type ZcNetChart, type ZcSettings } from "./zoomcharts";

export interface CanvasSelection {
  nodeIds: string[];
  edgeIds: string[];
}

export interface NetChartCanvasHandle {
  zoomBy(factor: number): void;
  fit(): void;
  reorganize(): void;
  focusNodes(ids: string[]): void;
  /** Posición actual de cada entidad en el lienzo (o `null` si el lienzo no está disponible). Se usa al exportar. */
  getPositions(): Map<string, { x: number; y: number }> | null;
}

interface Props {
  doc: GraphSnapshot;
  selection: CanvasSelection;
  dark: boolean;
  /** Halos que agrupan las entidades (presentación). Por defecto, ninguno. */
  auraMode?: AuraMode;
  /** URL de la imagen de cada entidad (mismo origen o `blob:`). Debe ser estable: se consulta al crear o actualizar nodos. */
  imageUrl?: ImageUrlResolver;
  /** Visor sin edición de datos. Por defecto las entidades no se arrastran; el visor compartido puede activar `nodesMovable`. */
  readOnly?: boolean;
  /** Arrastre de entidades con el diseño dinámico de ZoomCharts. Si no se indica, vale `!readOnly`. */
  nodesMovable?: boolean;
  /** Doble clic sobre una entidad (en el editor: expandir/contraer sus vecinos). */
  onNodeDoubleClick?(id: string): void;
  /** Se invoca al seleccionar con el ratón/tacto en el lienzo (no al cambiar la selección desde React). */
  onSelectionChange(selection: CanvasSelection): void;
  /** Un clic simple sobre un nodo (se usa en el modo "conectar"). */
  onNodeClick?(id: string): void;
  /** El usuario terminó de arrastrar uno o más nodos. */
  onNodesMoved?(positions: Array<{ id: string; x: number; y: number }>): void;
  /** Estado real del lienzo (cambia también si falla después de estar listo). */
  onStatusChange?(status: "loading" | "ready" | "error"): void;
  onError?(error: Error): void;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Lienzo de ZoomCharts NetChart. ZoomCharts es SOLO presentación: el documento (`doc`) es la fuente de verdad
 * y el lienzo se sincroniza con él; nunca se escribe en el estado desde dentro de ZoomCharts salvo mediante
 * los callbacks `onSelectionChange` / `onNodesMoved`, y solo durante un gesto del usuario.
 *
 * Robustez: la licencia de ZoomCharts se valida de forma asíncrona (petición de red) y, si falla, la librería
 * destruye su objeto interno DESPUÉS de crearlo. Por eso toda llamada a la librería pasa por `safe()`: un fallo
 * del lienzo lo deja en estado `error` (con «Reintentar») pero nunca rompe el resto del editor.
 *
 * Ciclo de vida: carga diferida y cancelable; al desmontar se llama a `chart.remove()` para liberar canvas,
 * listeners y temporizadores.
 */
export const NetChartCanvas = forwardRef<NetChartCanvasHandle, Props>(function NetChartCanvas(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ZcNetChart | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // Última versión de las props para que los callbacks del lienzo (creados una sola vez) no queden obsoletos.
  const propsRef = useRef(props);
  propsRef.current = props;

  // Documento ya cargado en el lienzo, para sincronizar solo las diferencias.
  const syncedRef = useRef<GraphSnapshot>({ nodes: [], edges: [] });
  // Evita bucles: la selección que React acaba de aplicar al lienzo no debe volver a emitirse.
  const applyingSelectionRef = useRef(false);
  // Un cambio de selección solo se acepta si nace de un gesto del usuario (clic, arrastre, recuadro). Los
  // cambios que provoca el propio código (o que ZoomCharts notifica de forma asíncrona) se ignoran: la
  // fuente de verdad es React, así que el lienzo nunca puede borrar la selección por una carrera.
  const gestureRef = useRef({ active: false, last: 0 });
  // La selección pedida por React incluye algo que el lienzo aún no ha creado (addData es asíncrono).
  const pendingSelectionRef = useRef(false);
  // Se asigna al crear el lienzo: libera el objeto roto y pasa a `error`.
  const failRef = useRef<(error: unknown) => void>(() => undefined);
  // Última posición de las entidades que se ocultaron (filtro/enfoque): al volver a mostrarse reaparecen donde estaban
  // en lugar de recolocarse. Solo vale mientras el documento no guarde una posición propia.
  const rememberedRef = useRef(new Map<string, { x: number; y: number }>());
  // URL de la imagen de cada entidad según el documento ya cargado: la lee `nodeStyleFunction` (ver más abajo).
  const imageUrlsRef = useRef(new Map<string, string | undefined>());
  const auraModeRef = useRef<AuraMode>(props.auraMode ?? "none");
  auraModeRef.current = props.auraMode ?? "none";
  // Huella de los ajustes de halos ya aplicados (evita reenviarlos si no cambian).
  const auraKeyRef = useRef("");
  const appliedAuraModeRef = useRef<AuraMode>(props.auraMode ?? "none");

  /** Ejecuta una llamada a ZoomCharts; si lanza, el lienzo pasa a `error` en lugar de romper la aplicación. */
  const safe = useCallback(<T,>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      failRef.current(error);
      return undefined;
    }
  }, []);

  /** Aplica al lienzo la selección de React. Devuelve `false` si falta algún objeto por crearse. */
  const applySelection = useCallback((): boolean => {
    const chart = chartRef.current;
    if (!chart) return true;
    return (
      safe(() => {
        const { selection } = propsRef.current;
        const wanted = [...selection.nodeIds.filter((id) => chart.getNode(id)), ...selection.edgeIds.filter((id) => chart.getLink(id))];
        const complete = wanted.length === selection.nodeIds.length + selection.edgeIds.length;
        if (!sameSet(chart.selection().map((i) => i.id), wanted)) {
          applyingSelectionRef.current = true;
          try {
            chart.selection(wanted);
          } finally {
            applyingSelectionRef.current = false;
          }
        }
        return complete;
      }) ?? true
    );
  }, [safe]);

  /** Envía al lienzo los estilos de halo si han cambiado (por ejemplo, al aparecer una etiqueta nueva). */
  const applyAuras = useCallback((chart: ZcNetChart, doc: GraphSnapshot, mode: AuraMode) => {
    const settings = auraSettings(doc, mode);
    const key = JSON.stringify(settings);
    if (key === auraKeyRef.current) return;
    auraKeyRef.current = key;
    chart.updateSettings({ auras: settings });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy(factor) {
        const chart = chartRef.current;
        if (chart) safe(() => chart.zoom(factor, true));
      },
      fit() {
        const chart = chartRef.current;
        // «overview» vuelve al encuadre automático de TODO lo que se ve (con un enfoque o filtros, solo eso).
        if (chart) safe(() => chart.zoom("overview", true));
      },
      reorganize() {
        const chart = chartRef.current;
        if (!chart) return;
        safe(() => {
          for (const n of chart.nodes()) chart.unlockNode(n);
          chart.resetLayout();
        });
      },
      focusNodes(ids) {
        const chart = chartRef.current;
        if (chart) safe(() => chart.scrollIntoView(ids));
      },
      getPositions() {
        const chart = chartRef.current;
        if (!chart) return null;
        return (
          safe(() => {
            const out = new Map<string, { x: number; y: number }>();
            for (const n of chart.nodes()) {
              const { x, y } = chart.getNodeDimensions(n);
              if (Number.isFinite(x) && Number.isFinite(y)) out.set(n.id, { x, y });
            }
            return out;
          }) ?? null
        );
      },
    }),
    [safe],
  );

  // --- Creación / destrucción del lienzo ---------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let chart: ZcNetChart | null = null;
    let observer: ResizeObserver | null = null;
    let frame = 0;

    setStatus("loading");
    setCanvasTheme(propsRef.current.dark);

    const release = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
      const c = chart;
      chart = null;
      chartRef.current = null;
      syncedRef.current = { nodes: [], edges: [] };
      rememberedRef.current.clear();
      imageUrlsRef.current.clear();
      auraKeyRef.current = "";
      if (c) {
        try {
          c.remove();
        } catch {
          /* ya liberado */
        }
      }
    };

    const fail = (error: unknown) => {
      if (cancelled) return;
      release();
      setStatus("error");
      propsRef.current.onError?.(error instanceof Error ? error : new Error("Error del lienzo."));
    };
    failRef.current = fail;

    loadZoomCharts()
      .then((zc) => {
        if (cancelled) return;
        const initial = propsRef.current.doc;
        imageUrlsRef.current = new Map(initial.nodes.map((n) => [n.id, propsRef.current.imageUrl?.(n)])); // antes de crear el lienzo
        const initialAuras = auraSettings(initial, auraModeRef.current);
        auraKeyRef.current = JSON.stringify(initialAuras);
        appliedAuraModeRef.current = auraModeRef.current;
        const settings: ZcSettings = {
          container,
          // El bundler renombra el script, así que la ruta de assets no se puede deducir: se fija explícitamente
          // a nuestro propio origen. `assets: []` evita cargar CSS/JS adicionales; `exportProxyURL` impide que una
          // exportación llegue a `echo.zoomcharts-cloud.com` (la exportación se hará siempre en local).
          assetsUrlBase: "/zc-assets/",
          advanced: { assets: [], exportProxyURL: "about:blank" },
          // Los créditos cargarían una imagen de js.zoomcharts.com (tercero). Se desactivan salvo que la licencia lo exija.
          credits: { enabled: false },
          toolbar: { enabled: false },
          legend: { enabled: false },
          breadcrumb: { enabled: false },
          nodeMenu: { enabled: false },
          linkMenu: { enabled: false },
          info: { enabled: false },
          area: { style: { fillColor: "transparent" } },
          navigation: { mode: "showall" },
          layout: { mode: "dynamic", nodeSpacing: 60, initialLayoutMaxTime: 600, incrementalLayoutMaxTime: 800 },
          interaction: {
            nodesMovable: propsRef.current.nodesMovable ?? !propsRef.current.readOnly,
            panning: { enabled: true },
            zooming: { wheel: true, fingers: true, zoomInOnDoubleClick: false, autoZoomAfterClick: false },
            selection: { enabled: true, nodesSelectable: true, linksSelectable: true, lockNodesOnMove: true, tolerance: 8 },
          },
          style: {
            linkLabel: { textStyle: { font: "12px ui-sans-serif, system-ui, sans-serif" } },
            // `addData` FUSIONA el estilo con el del nodo existente: una imagen que se quita en el documento seguiría pintándose.
            // Esta función se evalúa en cada actualización de estilo y fija siempre la imagen vigente (o ninguna).
            nodeStyleFunction: (node) => {
              node.image = imageUrlsRef.current.get(node.id) ?? undefined;
            },
          },
          // Con `auras: { enabled: false }` ZoomCharts desplaza la zona de detección del ratón respecto de lo dibujado
          // (se «mueve» el grafo al pasar el puntero): solo se pasa la configuración cuando de verdad hay halos.
          ...(initialAuras.enabled ? { auras: initialAuras } : {}),
          data: [{ preloaded: toZoomData(initial, auraModeRef.current, propsRef.current.imageUrl) }],
          events: {
            onClick: (_e, args) => {
              if (args.clickNode) propsRef.current.onNodeClick?.(args.clickNode.id);
            },
            onDoubleClick: (_e, args) => {
              if (args.clickNode) propsRef.current.onNodeDoubleClick?.(args.clickNode.id);
            },
            onPointerDown: () => {
              gestureRef.current = { active: true, last: Date.now() };
            },
            onChartUpdate: () => {
              // Los objetos recién añadidos aparecen un poco después de addData: se completa la selección pendiente.
              if (pendingSelectionRef.current) pendingSelectionRef.current = !applySelection();
            },
            onSelectionChange: () => {
              const g = gestureRef.current;
              const c = chart;
              if (applyingSelectionRef.current || !c || !(g.active || Date.now() - g.last < 400)) return;
              safe(() => {
                const nodeIds: string[] = [];
                const edgeIds: string[] = [];
                const known = new Set(syncedRef.current.nodes.map((n) => n.id));
                for (const item of c.selection()) (known.has(item.id) ? nodeIds : edgeIds).push(item.id);
                propsRef.current.onSelectionChange({ nodeIds, edgeIds });
              });
            },
            onPointerUp: () => {
              gestureRef.current = { active: false, last: Date.now() };
              const c = chart;
              if (!c) return;
              safe(() => {
                const moved: Array<{ id: string; x: number; y: number }> = [];
                const byId = new Map(syncedRef.current.nodes.map((n) => [n.id, n]));
                for (const n of c.nodes()) {
                  const node = byId.get(n.id);
                  if (!node || !n.userLock) continue;
                  const { x, y } = c.getNodeDimensions(n);
                  if (node.positionX === null || node.positionY === null || Math.hypot(node.positionX - x, node.positionY - y) > 0.5) {
                    moved.push({ id: n.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
                  }
                }
                if (moved.length > 0) propsRef.current.onNodesMoved?.(moved);
              });
            },
            onError: (_e, args) => propsRef.current.onError?.(new Error(String(args?.message ?? "Error de ZoomCharts"))),
          },
        };

        const created = new zc.NetChart(settings);
        chart = created;
        chartRef.current = created;
        syncedRef.current = initial;
        observer = new ResizeObserver(() => safe(() => created.updateSize()));
        observer.observe(container);

        // Con una licencia ausente o inválida ZoomCharts NO lanza una excepción: registra un error en la consola y
        // deja un objeto inerte sin <canvas>. Solo se da el lienzo por listo cuando de verdad existe un <canvas>.
        const startedAt = performance.now();
        const waitForCanvas = () => {
          if (cancelled || chartRef.current !== created) return;
          if (container.querySelector("canvas")) {
            setStatus("ready");
          } else if (performance.now() - startedAt > 3000) {
            fail(new Error("ZoomCharts no inicializó el lienzo (¿licencia ausente o inválida?)."));
          } else {
            frame = requestAnimationFrame(waitForCanvas);
          }
        };
        frame = requestAnimationFrame(waitForCanvas);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      release();
    };
  }, [attempt, applySelection, safe]);

  useEffect(() => {
    propsRef.current.onStatusChange?.(status);
  }, [status]);

  // --- Sincronización incremental del documento --------------------------------------------------
  const { doc } = props;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || status !== "ready") return;
    const prev = syncedRef.current;
    if (prev === doc) return;

    const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
    const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
    const nextNodeIds = new Set(doc.nodes.map((n) => n.id));
    const nextEdgeIds = new Set(doc.edges.map((e) => e.id));

    const removedNodes = prev.nodes.filter((n) => !nextNodeIds.has(n.id));
    const removedEdges = prev.edges.filter((e) => !nextEdgeIds.has(e.id));
    const changedNodes = doc.nodes.filter((n) => prevNodes.get(n.id) !== n);
    const changedEdges = doc.edges.filter((e) => prevEdges.get(e.id) !== e);

    safe(() => {
      if (removedNodes.length > 0 || removedEdges.length > 0) {
        // Se recuerda dónde estaban las entidades que se quitan (por filtro o enfoque) para devolverlas a su sitio.
        // Es opcional: si algo falla aquí, igualmente se retiran los datos.
        for (const n of removedNodes) {
          try {
            const zn = chart.getNode(n.id);
            if (!zn) continue;
            const { x, y } = chart.getNodeDimensions(zn);
            if (Number.isFinite(x) && Number.isFinite(y)) rememberedRef.current.set(n.id, { x, y });
          } catch {
            /* sin posición recordada */
          }
        }
        chart.removeData({
          nodes: removedNodes.map((n) => ({ id: n.id, loaded: true })),
          links: removedEdges.filter((e) => nextNodeIds.has(e.sourceId) && nextNodeIds.has(e.targetId)).map((e) => ({ id: e.id, from: e.sourceId, to: e.targetId })),
        });
      }
      if (changedNodes.length > 0 || changedEdges.length > 0) {
        const mode = auraModeRef.current;
        applyAuras(chart, doc, mode);
        for (const n of doc.nodes) imageUrlsRef.current.set(n.id, propsRef.current.imageUrl?.(n));
        chart.addData({
          // Solo las que vuelven a aparecer recuperan su posición recordada; las que ya estaban conservan la actual.
          nodes: changedNodes.map((n) => toZoomNode(n, mode, prevNodes.has(n.id) ? undefined : rememberedRef.current.get(n.id), propsRef.current.imageUrl)),
          links: changedEdges.map(toZoomLink),
        });
        chart.updateStyle([...changedNodes.map((n) => n.id), ...changedEdges.map((e) => e.id)]);
      }
      syncedRef.current = doc;
    });
  }, [doc, status, safe, applyAuras]);

  // --- Halos ---------------------------------------------------------------------------------------
  const { auraMode = "none" } = props;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || status !== "ready") return;
    // Al crear el lienzo el modo ya viaja en los datos iniciales: solo se actúa si cambia después.
    if (appliedAuraModeRef.current === auraMode) return;
    appliedAuraModeRef.current = auraMode;
    safe(() => {
      const current = syncedRef.current;
      applyAuras(chart, current, auraMode);
      // El halo de cada entidad es un dato del nodo: se reenvían los nodos (los ya existentes solo se actualizan).
      chart.addData({ nodes: current.nodes.map((n) => toZoomNode(n, auraMode, undefined, propsRef.current.imageUrl)), links: [] });
      chart.updateStyle(current.nodes.map((n) => n.id));
    });
  }, [auraMode, status, safe, applyAuras]);

  // --- Selección controlada desde React ----------------------------------------------------------
  const { selection } = props;
  useEffect(() => {
    if (status !== "ready") return;
    // Si falta algún objeto (todavía no creado por addData), se reintenta en el siguiente `chartUpdate`.
    pendingSelectionRef.current = !applySelection();
  }, [selection, doc, status, applySelection]);

  // --- Tema claro/oscuro -------------------------------------------------------------------------
  const { dark } = props;
  useEffect(() => {
    setCanvasTheme(dark);
    const chart = chartRef.current;
    if (chart && status === "ready") safe(() => chart.updateStyle());
  }, [dark, status, safe]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full overflow-hidden" data-testid="net-chart" data-status={status} />
      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status">
          Cargando el lienzo…
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 p-6 text-center text-sm" role="alert">
          <p className="max-w-sm text-destructive">No se pudo cargar el lienzo del grafo. Revisa la licencia de ZoomCharts y tu conexión.</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : null}
    </div>
  );
});
