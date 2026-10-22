import { ENTITY_CATALOG, type GraphNodeData } from "@a-link/shared";
import { Maximize, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { NetChartCanvas, type CanvasSelection, type NetChartCanvasHandle } from "../editor/net-chart-canvas";
import { type SharedGraph, SharedLinkError, fetchSharedGraph, fetchSharedImages } from "./queries";
import { tokenFromHash } from "./share-link";

type State = { phase: "loading" } | { phase: "error"; error: SharedLinkError } | { phase: "ready"; graph: SharedGraph; images: Map<string, string> };

const NONE: CanvasSelection = { nodeIds: [], edgeIds: [] };

/**
 * Visor PÚBLICO y de SOLO LECTURA de un grafo compartido (`/s#<token>`). No usa la sesión del usuario: el token del
 * fragmento se envía en la cabecera `X-Share-Token`. No hay edición, ni exportación, ni notas ni datos sensibles: el
 * servidor ya los excluye de la respuesta. Puede abrirse dentro de un `<iframe>` (p. ej. el complemento «Web Viewer» de
 * PowerPoint) si el despliegue lo permite (ver `SHARE_FRAME_ANCESTORS`).
 */
export function SharedViewPage() {
  const { dark, toggle } = useTheme();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [selection, setSelection] = useState<CanvasSelection>(NONE);
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
        const graph = await fetchSharedGraph(token, controller.signal);
        const images = await fetchSharedImages(token, graph.doc.nodes.flatMap((n) => (n.imageId ? [n.imageId] : [])), controller.signal);
        urls.push(...images.values());
        if (controller.signal.aborted) return;
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

  // El lienzo pide la imagen de cada entidad por esta función: aquí son `blob:` ya descargados con el token.
  const images = state.phase === "ready" ? state.images : null;
  const imageUrl = useMemo(() => (images ? (n: GraphNodeData) => (n.imageId ? images.get(n.imageId) : undefined) : undefined), [images]);

  const selected = state.phase === "ready" && selection.nodeIds[0] ? state.graph.doc.nodes.find((n) => n.id === selection.nodeIds[0]) : undefined;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Brand className="text-base [&_svg]:size-6" />
        <div className="min-w-0 flex-1">
          {state.phase === "ready" ? (
            <>
              <h1 className="truncate text-sm font-semibold">{state.graph.name}</h1>
              <p className="text-xs text-muted-foreground">Vista de solo lectura · válido hasta {formatDateTime(state.graph.expiresAt)}</p>
            </>
          ) : (
            <h1 className="text-sm font-semibold">Grafo compartido</h1>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => canvasRef.current?.fit()} disabled={state.phase !== "ready"}>
          <Maximize aria-hidden="true" /> Ajustar a la vista
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Tema claro" : "Tema oscuro"}>
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </header>

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
        {state.phase === "ready" && (
          <>
            <NetChartCanvas ref={canvasRef} doc={state.graph.doc} selection={selection} dark={dark} {...(imageUrl ? { imageUrl } : {})} onSelectionChange={setSelection} readOnly />
            <p className="sr-only">Visor de solo lectura. Entidades: {state.graph.doc.nodes.map((n) => n.label).join(", ")}.</p>
            {selected && <EntityCard node={selected} />}
          </>
        )}
      </main>
    </div>
  );
}

function EntityCard({ node }: { node: GraphNodeData }) {
  const def = ENTITY_CATALOG[node.type];
  const rows = def.fields.flatMap((f) => (node.metadata[f.key] ? [[f.label, node.metadata[f.key]!] as const] : []));
  return (
    <aside aria-label={`Datos de ${node.label}`} className="absolute bottom-3 left-3 max-w-xs rounded-lg border bg-card p-3 text-sm shadow-lg">
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
    </aside>
  );
}
