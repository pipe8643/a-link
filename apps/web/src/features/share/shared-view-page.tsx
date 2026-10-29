import { ENTITY_CATALOG, type GraphNodeData } from "@a-link/shared";
import { Maximize, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LetterheadFrame } from "@/branding/letterhead-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { NetChartCanvas, type CanvasSelection, type NetChartCanvasHandle } from "../editor/net-chart-canvas";
import { useGraphView } from "../editor/use-graph-view";
import { type SharedGraph, SharedLinkError, fetchSharedGraph, fetchSharedImages, fetchSharedLetterhead } from "./queries";
import { ShareExplorePanel } from "./share-explore-panel";
import { tokenFromHash } from "./share-link";

type State = { phase: "loading" } | { phase: "error"; error: SharedLinkError } | { phase: "ready"; graph: SharedGraph; images: Map<string, string> };

const NONE: CanvasSelection = { nodeIds: [], edgeIds: [] };

const EXPLORE_STATUS = {
  focused: "Grafo retraído a esa entidad y sus vecinos.",
  expanded: "Vecinos extendidos.",
  collapsed: "Vecinos retraídos.",
  showall: "Se ve el grafo completo.",
} as const;

/**
 * Visor PÚBLICO de un grafo compartido (`/s#<token>`). No usa la sesión: el token del fragmento viaja en
 * `X-Share-Token`. No hay edición ni notas ni campos sensibles. Sí hay exploración: filtrar categorías, arrastrar
 * entidades (animación de ZoomCharts) y retraer/extender vecinos con doble clic. Puede incrustarse en PowerPoint
 * (Web Viewer).
 */
export function SharedViewPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [letterheadSrc, setLetterheadSrc] = useState<string | undefined>();
  const canvasRef = useRef<NetChartCanvasHandle>(null);

  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    if (!token) {
      setState({ phase: "error", error: new SharedLinkError("invalid") });
      return;
    }
    const controller = new AbortController();
    const urls: string[] = [];
    (async () => {
      try {
        const [graph, customBg] = await Promise.all([fetchSharedGraph(token, controller.signal), fetchSharedLetterhead(token, controller.signal)]);
        if (customBg) urls.push(customBg);
        const images = await fetchSharedImages(token, graph.doc.nodes.flatMap((n) => (n.imageId ? [n.imageId] : [])), controller.signal);
        urls.push(...images.values());
        if (controller.signal.aborted) return;
        if (customBg) setLetterheadSrc(customBg);
        setState({ phase: "ready", graph, images });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setState({ phase: "error", error: err instanceof SharedLinkError ? err : new SharedLinkError("network") });
      }
    })();
    document.title = "Grafo compartido · A-Link";
    return () => {
      controller.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  return (
    <LetterheadFrame src={letterheadSrc}>
      <main className="relative min-h-0 flex-1">
        {state.phase === "loading" && (
          <div className="grid h-full place-items-center p-6" role="status" aria-label="Cargando el grafo">
            <Skeleton className="h-40 w-64" />
          </div>
        )}
        {state.phase === "error" && (
          <div className="grid h-full place-content-center justify-items-center gap-2 p-6 text-center" role="alert">
            <h2 className="text-lg font-semibold">{state.error.kind === "network" ? "No se pudo cargar el grafo" : state.error.kind === "format" ? "No se pudo leer el grafo" : "Enlace no disponible"}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {state.error.kind === "invalid"
                ? "Este enlace no es válido, ha caducado o su propietario lo revocó. Pide uno nuevo a quien te lo compartió."
                : state.error.message}
            </p>
            {state.error.kind === "network" && (
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            )}
          </div>
        )}
        {state.phase === "ready" && <SharedGraphExplorer graph={state.graph} images={state.images} dark={false} canvasRef={canvasRef} />}
      </main>
      <footer className="flex items-center gap-3 px-1 py-1">
        <div className="min-w-0 flex-1">
          {state.phase === "ready" ? (
            <>
              <h1 className="truncate text-sm font-semibold">{state.graph.name}</h1>
              <p className="text-xs text-muted-foreground">Vista interactiva de solo lectura · válido hasta {formatDateTime(state.graph.expiresAt)}</p>
            </>
          ) : (
            <h1 className="text-sm font-semibold">Grafo compartido</h1>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => canvasRef.current?.fit()} disabled={state.phase !== "ready"}>
          <Maximize aria-hidden="true" /> Ajustar a la vista
        </Button>
      </footer>
    </LetterheadFrame>
  );
}

/** Lienzo vivo: filtros, arrastre y retraer/extender. No persiste movimientos (el enlace es de solo lectura). */
export function SharedGraphExplorer({
  graph,
  images,
  dark,
  canvasRef,
}: {
  graph: SharedGraph;
  images: Map<string, string>;
  dark: boolean;
  canvasRef: RefObject<NetChartCanvasHandle | null>;
}) {
  const [selection, setSelection] = useState<CanvasSelection>(NONE);
  const [status, setStatus] = useState<string | null>(null);
  const graphView = useGraphView(graph.doc, { nodeIds: selection.nodeIds, edgeIds: selection.edgeIds });
  const imageUrl = useMemo(() => (n: GraphNodeData) => (n.imageId ? images.get(n.imageId) : undefined), [images]);
  const selected = selection.nodeIds[0] ? graph.doc.nodes.find((n) => n.id === selection.nodeIds[0]) : undefined;

  return (
    <>
      <NetChartCanvas
        ref={canvasRef}
        doc={graphView.result.doc}
        selection={selection}
        dark={dark}
        imageUrl={imageUrl}
        onSelectionChange={setSelection}
        onNodeDoubleClick={(id) => {
          const action = graphView.explore(id);
          setStatus(action ? EXPLORE_STATUS[action] : null);
        }}
        readOnly
        nodesMovable
      />
      <ShareExplorePanel doc={graph.doc} graphView={graphView} />
      <p className="sr-only">
        Visor interactivo de solo lectura. Entidades: {graph.doc.nodes.map((n) => n.label).join(", ")}.
      </p>
      {status && (
        <p role="status" className="sr-only">
          {status}
        </p>
      )}
      {selected && <EntityCard node={selected} graphView={graphView} onStatus={setStatus} />}
    </>
  );
}

function EntityCard({
  node,
  graphView,
  onStatus,
}: {
  node: GraphNodeData;
  graphView: ReturnType<typeof useGraphView>;
  onStatus(text: string | null): void;
}) {
  const def = ENTITY_CATALOG[node.type];
  const rows = def.fields.flatMap((f) => (node.metadata[f.key] ? [[f.label, node.metadata[f.key]!] as const] : []));
  const hidden = graphView.hiddenNeighborIds(node.id);
  const canCollapse = graphView.canCollapse(node.id);
  const focusActive = graphView.result.focusActive;
  const isRoot = graphView.result.roots.has(node.id);

  return (
    <aside aria-label={`Datos de ${node.label}`} className="absolute right-3 bottom-3 z-10 max-w-xs rounded-lg border bg-card p-3 text-sm shadow-lg">
      <div className="flex items-center gap-2">
        <h2 className="truncate font-semibold">{node.label}</h2>
        <Badge variant="secondary">{def.name}</Badge>
      </div>
      {node.tags.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{node.tags.join(" · ")}</p>}
      {rows.length > 0 && (
        <dl className="mt-2 grid gap-1">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const action = graphView.explore(node.id);
            onStatus(action ? EXPLORE_STATUS[action] : null);
          }}
        >
          {focusActive && (hidden.length > 0 || canCollapse || isRoot) ? (
            hidden.length > 0 ? (
              <>
                <Maximize2 aria-hidden="true" /> Extender ({hidden.length})
              </>
            ) : canCollapse || isRoot ? (
              <>
                <Minimize2 aria-hidden="true" /> Retraer
              </>
            ) : (
              "Explorar"
            )
          ) : (
            <>
              <Minimize2 aria-hidden="true" /> Retraer a vecinos
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
