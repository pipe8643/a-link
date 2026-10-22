import { Download, Link2, Maximize, Redo2, Share2, Shuffle, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { NetChartCanvasHandle } from "./net-chart-canvas";
import type { EditorApi } from "./use-editor";

interface Props {
  editor: EditorApi;
  canvas: React.RefObject<NetChartCanvasHandle | null>;
  canvasReady: boolean;
  connecting: boolean;
  onToggleConnect(): void;
  onNewRelationship(): void;
  onDelete(): void;
  onExport(): void;
  onShare(): void;
}

function Tool({ label, onClick, disabled, pressed, children }: { label: string; onClick(): void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <Button type="button" variant={pressed ? "default" : "outline"} size="sm" onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={label} title={label}>
      {children}
    </Button>
  );
}

/** Barra de herramientas del lienzo. Cada botón tiene nombre accesible; el estado activo se anuncia con aria-pressed. */
export function EditorToolbar({ editor, canvas, canvasReady, connecting, onToggleConnect, onNewRelationship, onDelete, onExport, onShare }: Props) {
  const hasSelection = editor.selection.nodeIds.length + editor.selection.edgeIds.length > 0;
  return (
    <div role="toolbar" aria-label="Herramientas del editor" className="flex flex-wrap items-center gap-1.5 border-b bg-background p-2">
      <Tool label="Deshacer (Ctrl+Z)" onClick={editor.undo} disabled={!editor.canUndo}>
        <Undo2 aria-hidden="true" />
      </Tool>
      <Tool label="Rehacer (Ctrl+Y)" onClick={editor.redo} disabled={!editor.canRedo}>
        <Redo2 aria-hidden="true" />
      </Tool>
      <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
      <Tool label="Acercar" onClick={() => canvas.current?.zoomBy(1.4)} disabled={!canvasReady}>
        <ZoomIn aria-hidden="true" />
      </Tool>
      <Tool label="Alejar" onClick={() => canvas.current?.zoomBy(1 / 1.4)} disabled={!canvasReady}>
        <ZoomOut aria-hidden="true" />
      </Tool>
      <Tool label="Ajustar a la vista" onClick={() => canvas.current?.fit()} disabled={!canvasReady || editor.doc.nodes.length === 0}>
        <Maximize aria-hidden="true" />
      </Tool>
      <Tool label="Reorganizar automáticamente" onClick={() => canvas.current?.reorganize()} disabled={!canvasReady || editor.doc.nodes.length === 0}>
        <Shuffle aria-hidden="true" />
      </Tool>
      <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
      <Tool label="Modo conectar: clic en origen y destino" onClick={onToggleConnect} pressed={connecting} disabled={editor.doc.nodes.length < 2}>
        <Link2 aria-hidden="true" />
        <span className="hidden sm:inline">Conectar</span>
      </Tool>
      <Button type="button" variant="outline" size="sm" onClick={onNewRelationship} disabled={editor.doc.nodes.length < 2}>
        Nueva relación…
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={!hasSelection} aria-label="Eliminar selección (Supr)">
        <Trash2 aria-hidden="true" />
        <span className="hidden sm:inline">Eliminar</span>
      </Button>
      <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
      <Button type="button" variant="outline" size="sm" onClick={onShare}>
        <Share2 aria-hidden="true" />
        Compartir…
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={editor.doc.nodes.length === 0}>
        <Download aria-hidden="true" />
        Exportar…
      </Button>
    </div>
  );
}
