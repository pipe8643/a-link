import { ArrowLeft, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { QueryError } from "@/components/page";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NotFoundView } from "@/pages/not-found";
import { fetchGraphContent, saveGraphContent, useGraph, useGraphContent } from "@/features/library/queries";
import { EditorToolbar } from "./editor-toolbar";
import { LeftPanel } from "./left-panel";
import { NetChartCanvas, type NetChartCanvasHandle } from "./net-chart-canvas";
import { RelationshipDialog, type RelationshipDialogMode } from "./relationship-dialog";
import { RightPanel } from "./right-panel";
import { graphImageUrl } from "../images/queries";
import { ExportDialog } from "../export/export-dialog";
import { ShareDialog } from "../share/share-dialog";
import { useOnExportSaved } from "../exports/queries";
import { ConflictDialog, SaveStatusIndicator } from "./save-status";
import { useAutosave } from "./use-autosave";
import { useEditor } from "./use-editor";
import { useGraphView } from "./use-graph-view";
import { viewSummary } from "./view-filters";
import { graphSnapshotSchema, type EntityTypeId, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function EditorPage() {
  const { graphId = "" } = useParams();
  // Un identificador mal formado nunca llega a la API.
  return UUID_RE.test(graphId) ? <EditorLoader graphId={graphId} /> : <NotFoundView />;
}

function EditorLoader({ graphId }: { graphId: string }) {
  const graph = useGraph(graphId);
  if (graph.isPending) return <Skeleton className="m-4 h-[70dvh]" />;
  if (graph.isError) {
    return isApiError(graph.error) && graph.error.status === 404 ? <NotFoundView /> : <div className="p-4"><QueryError error={graph.error} onRetry={() => void graph.refetch()} /></div>;
  }
  if (graph.data.deletedAt) {
    return (
      <div className="mx-auto grid max-w-md gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Este grafo está en la papelera</h1>
        <p className="text-sm text-muted-foreground">Restáuralo desde la papelera para poder editarlo.</p>
        <Button asChild>
          <Link to="/trash">Ir a la papelera</Link>
        </Button>
      </div>
    );
  }
  return <ContentLoader graphId={graphId} name={graph.data.name} />;
}

/** Descarga el contenido guardado y lo valida con el MISMO esquema que usa el servidor antes de abrir el editor. */
function ContentLoader({ graphId, name }: { graphId: string; name: string }) {
  const content = useGraphContent(graphId);
  const snapshot = useMemo(() => {
    if (!content.data) return null;
    const parsed = graphSnapshotSchema.safeParse({ nodes: content.data.nodes, edges: content.data.edges });
    return parsed.success ? parsed.data : "invalid";
  }, [content.data]);

  if (content.isPending) return <Skeleton className="m-4 h-[70dvh]" />;
  if (content.isError) {
    if (isApiError(content.error) && content.error.status === 404) return <NotFoundView />;
    return (
      <div className="p-4">
        <QueryError error={content.error} onRetry={() => void content.refetch()} />
      </div>
    );
  }
  if (snapshot === "invalid" || snapshot === null) {
    return (
      <div role="alert" className="mx-auto grid max-w-md gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">No se puede abrir este grafo</h1>
        <p className="text-sm text-muted-foreground">Su contenido guardado no tiene un formato válido. No se ha modificado nada.</p>
        <Button asChild>
          <Link to={`/graphs/${graphId}`}>Volver</Link>
        </Button>
      </div>
    );
  }
  return <Editor graphId={graphId} name={name} initialDoc={snapshot} initialRevision={content.data.revision} />;
}

type MobileTab = "list" | "canvas" | "details";

function Editor({ graphId, name, initialDoc, initialRevision }: { graphId: string; name: string; initialDoc: GraphSnapshot; initialRevision: number }) {
  const editor = useEditor(initialDoc);
  const autosave = useAutosave({
    doc: editor.doc,
    version: editor.version,
    initialRevision,
    save: (doc, expectedRevision) => saveGraphContent(graphId, { expectedRevision, nodes: doc.nodes, edges: doc.edges }),
  });
  const [conflictOpen, setConflictOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const onExportSaved = useOnExportSaved();
  // El aviso se abre solo cuando aparece el conflicto (y se puede reabrir desde la cabecera).
  useEffect(() => {
    if (autosave.status === "conflict") setConflictOpen(true);
    else setConflictOpen(false);
  }, [autosave.status]);

  const reloadFromServer = useCallback(async () => {
    const fresh = await fetchGraphContent(graphId);
    const parsed = graphSnapshotSchema.safeParse({ nodes: fresh.nodes, edges: fresh.edges });
    if (!parsed.success) throw new Error("invalid");
    editor.load(parsed.data);
    autosave.adopt(fresh.revision, { version: 0 });
    toast.success("Se cargó la versión del servidor.");
  }, [autosave, editor, graphId]);

  const overwriteServer = useCallback(async () => {
    const { graph } = await api<{ graph: { revision: number } }>(`/graphs/${graphId}`);
    autosave.adopt(graph.revision, { dirty: true });
  }, [autosave, graphId]);
  const { dark, toggle } = useTheme();
  const canvasRef = useRef<NetChartCanvasHandle>(null);
  // Las imágenes se piden con la cookie de sesión a una URL que el servidor autoriza en cada lectura.
  const imageUrl = useCallback((node: GraphNodeData) => (node.imageId ? graphImageUrl(graphId, node.imageId) : undefined), [graphId]);
  const [canvasStatus, setCanvasStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState<RelationshipDialogMode | null>(null);
  const [connect, setConnect] = useState<{ sourceId: string | null } | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("canvas");

  const { selection, nodesById, doc } = editor;
  // Vista (filtros, enfoque, halos): solo presentación. El autoguardado y el historial siguen con el documento completo.
  const graphView = useGraphView(doc, selection);
  const { reveal: revealInView, toggleExpand } = graphView;

  // --- Aviso al cerrar con cambios que aún no están a salvo en el servidor --------------------------
  const unsaved = autosave.status !== "saved";
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  // --- Acciones ----------------------------------------------------------------------------------
  const addEntity = useCallback(
    (type: EntityTypeId) => {
      const r = editor.addEntity(type);
      if (!r.ok) toast.error(r.errors._form ?? "No se pudo añadir la entidad.");
      else {
        revealInView(r.node.id, type);
        setMobileTab("details");
      }
    },
    [editor, revealInView],
  );

  const deleteSelection = useCallback(() => {
    const count = selection.nodeIds.length + selection.edgeIds.length;
    if (count === 0) return;
    editor.deleteSelection();
    toast(count === 1 ? "Elemento eliminado" : `${count} elementos eliminados`, { action: { label: "Deshacer", onClick: editor.undo } });
  }, [editor, selection]);

  const activateForConnect = useCallback(
    (id: string) => {
      if (!connect) return;
      if (!connect.sourceId) {
        setConnect({ sourceId: id });
        editor.setSelection({ nodeIds: [id], edgeIds: [] });
      } else if (connect.sourceId !== id) {
        setDialog({ type: "new", sourceId: connect.sourceId, targetId: id });
        setConnect(null);
      }
    },
    [connect, editor],
  );

  const pickNode = useCallback(
    (id: string) => {
      if (connect) activateForConnect(id);
      else editor.setSelection({ nodeIds: [id], edgeIds: [] });
      if (!connect) setMobileTab("details");
    },
    [activateForConnect, connect, editor],
  );

  const pickEdge = useCallback(
    (id: string) => {
      setConnect(null);
      editor.setSelection({ nodeIds: [], edgeIds: [id] });
      setMobileTab("details");
    },
    [editor],
  );

  const toggleConnect = useCallback(() => {
    setConnect((c) => (c ? null : { sourceId: selection.nodeIds.length === 1 ? (selection.nodeIds[0] ?? null) : null }));
  }, [selection.nodeIds]);

  // --- Atajos de teclado (no actúan al escribir en un campo ni con un diálogo abierto) -----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || dialog || document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        editor.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.nodeIds.length + selection.edgeIds.length > 0) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (e.key === "Escape" && connect) {
        setConnect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connect, deleteSelection, dialog, editor, selection]);

  const connectHint = connect
    ? connect.sourceId
      ? `Origen: ${nodesById.get(connect.sourceId)?.label ?? ""}. Elige la entidad destino. Esc para cancelar.`
      : "Modo conectar: elige la entidad de origen. Esc para cancelar."
    : null;

  const summary = viewSummary(graphView, doc);

  const onNodeDoubleClick = useCallback(
    (id: string) => {
      const r = toggleExpand(id);
      if (r) toast(r === "expanded" ? "Vecinos mostrados" : "Vecinos ocultados");
    },
    [toggleExpand],
  );

  const panel = (tab: MobileTab) => (mobileTab === tab ? "flex" : "hidden");

  return (
    <div className="flex h-dvh flex-col bg-background">
      <a href="#lienzo" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Saltar al lienzo
      </a>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/graphs/${graphId}`}>
            <ArrowLeft aria-hidden="true" /> <span className="hidden sm:inline">Volver</span>
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h1>
        <SaveStatusIndicator autosave={autosave} onResolveConflict={() => setConflictOpen(true)} />
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Tema claro" : "Tema oscuro"}>
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </header>


      {/* Navegación entre paneles en pantallas pequeñas */}
      <div role="tablist" aria-label="Paneles del editor" className="grid grid-cols-3 gap-1 border-b p-1 text-sm lg:hidden">
        {(
          [
            ["list", "Entidades"],
            ["canvas", "Lienzo"],
            ["details", "Detalles"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)} className={cn("rounded px-2 py-1.5 font-medium", mobileTab === id ? "bg-accent" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Entidades y relaciones" className={cn("w-full shrink-0 border-r lg:flex lg:w-72", panel("list"))}>
          <div className="min-h-0 w-full flex-1">
            <LeftPanel editor={editor} onAddEntity={addEntity} onPickNode={pickNode} onPickEdge={pickEdge} connectSourceId={connect?.sourceId ?? null} graphView={graphView} />
          </div>
        </aside>

        <section id="lienzo" tabIndex={-1} aria-label="Lienzo del grafo" className={cn("min-w-0 flex-1 flex-col outline-hidden lg:flex", panel("canvas"))}>
          <EditorToolbar
            editor={editor}
            canvas={canvasRef}
            canvasReady={canvasStatus === "ready"}
            connecting={connect !== null}
            onToggleConnect={toggleConnect}
            onNewRelationship={() => setDialog({ type: "new", sourceId: selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined })}
            onDelete={deleteSelection}
            onExport={() => setExportOpen(true)}
            onShare={() => setShareOpen(true)}
          />
          <p role="status" aria-live="polite" className={cn("border-b bg-primary/10 px-3 py-1.5 text-sm", !connectHint && "sr-only")}>
            {connectHint ?? ""}
          </p>
          {canvasStatus === "error" && (
            <p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
              El lienzo no está disponible. Puedes seguir creando y editando entidades y relaciones desde los paneles.
            </p>
          )}
          <div className="relative min-h-0 flex-1">
            {summary && (
              <div role="status" aria-live="polite" className="absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur">
                <span className="min-w-0 flex-1">{summary}</span>
                <Button type="button" size="sm" variant="outline" onClick={graphView.showAll}>
                  Mostrar todo
                </Button>
              </div>
            )}
            <NetChartCanvas
              ref={canvasRef}
              doc={graphView.result.doc}
              selection={selection}
              auraMode={graphView.auraMode}
              imageUrl={imageUrl}
              onNodeDoubleClick={onNodeDoubleClick}
              dark={dark}
              onSelectionChange={editor.setSelection}
              onNodeClick={connect ? activateForConnect : undefined}
              onNodesMoved={editor.moveNodes}
              onStatusChange={setCanvasStatus}
            />
            {doc.nodes.length > 0 && graphView.result.doc.nodes.length === 0 && canvasStatus !== "error" && (
              <p className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted-foreground">La vista actual no muestra ninguna entidad. Cambia los filtros o pulsa «Mostrar todo».</p>
            )}
            {doc.nodes.length === 0 && canvasStatus !== "error" && (
              <p className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted-foreground">
                El lienzo está vacío. Añade una entidad desde la paleta de la izquierda.
              </p>
            )}
          </div>
          <p className="sr-only">Alternativa accesible al lienzo: usa las listas de entidades y relaciones y el panel de detalles.</p>
        </section>

        <aside aria-label="Detalles" className={cn("w-full shrink-0 overflow-y-auto border-l lg:flex lg:w-80", panel("details"))}>
          <div className="w-full">
            <RightPanel
              graphId={graphId}
              editor={editor}
              onConnectFrom={(id) => setDialog({ type: "new", sourceId: id })}
              onEditEdge={(edge) => setDialog({ type: "edit", edge })}
              onDelete={deleteSelection}
              onPickEdge={pickEdge}
              graphView={graphView}
            />
          </div>
        </aside>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} graphName={name} doc={doc} viewDoc={graphView.result.doc} auraMode={graphView.auraMode} dark={dark} canvas={canvasRef} graphId={graphId} onSaved={onExportSaved} />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} graphId={graphId} />
      <ConflictDialog open={conflictOpen} onClose={() => setConflictOpen(false)} onReload={reloadFromServer} onOverwrite={overwriteServer} />

      <RelationshipDialog
        mode={dialog}
        nodes={doc.nodes}
        edges={doc.edges}
        onClose={() => setDialog(null)}
        onSubmit={(edge, isNew) => {
          if (isNew) editor.addRelationship(edge);
          else editor.updateRelationship(edge);
          setDialog(null);
        }}
      />
    </div>
  );
}
