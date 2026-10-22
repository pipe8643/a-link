import type { GraphSnapshot } from "@a-link/shared";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FormError, SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AURA_MODE_LABELS, type AuraMode } from "../editor/auras";
import type { NetChartCanvasHandle } from "../editor/net-chart-canvas";
import { describeError } from "@/lib/form-errors";
import { type StoredFile, uploadExport } from "../exports/queries";
import { downloadBytes } from "./download";
import {
  ASPECTS,
  ASPECT_LABELS,
  BACKGROUND_LABELS,
  EXPORT_FORMATS,
  FORMAT_LABELS,
  PAGE_LABELS,
  PAGE_SIZES,
  RESOLUTIONS,
  RESOLUTION_LABELS,
  type Background,
  type ExportFormat,
  type ExportOptions,
  defaultExportOptions,
} from "./export-options";
import { graphImageUrl } from "../images/queries";
import { createShare } from "../share/queries";
import { buildShareUrl } from "../share/share-link";
import { EmptyGraphError, runExport } from "./run-export";
import { ExportTooLargeError, PPTX_EDITABLE_LIMITS, type LiveShare } from "./pptx";

interface Props {
  open: boolean;
  onClose(): void;
  graphName: string;
  /** Grafo completo. */
  doc: GraphSnapshot;
  /** Lo que se ve ahora en el lienzo (el mismo objeto que `doc` si no hay filtros ni enfoque). */
  viewDoc?: GraphSnapshot;
  /** Halos activos en el editor. */
  auraMode?: AuraMode;
  dark: boolean;
  canvas: React.RefObject<NetChartCanvasHandle | null>;
  /** Con el identificador del grafo se ofrece guardar, además, una copia privada en la cuenta del usuario. */
  graphId?: string;
  /** Se avisa cuando la copia se guardó (p. ej. para refrescar el listado de exportaciones). */
  onSaved?(file: StoredFile): void;
}

const isImage = (f: ExportFormat) => f === "png" || f === "jpeg";
const hasDocumentOptions = (f: ExportFormat) => f === "pdf" || f === "pptx-image" || f === "pptx-editable" || f === "pptx-live";
const usesRaster = (f: ExportFormat) => f !== "pptx-editable";

export function ExportDialog({ open, onClose, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">{open ? <ExportForm onClose={onClose} {...rest} /> : null}</DialogContent>
    </Dialog>
  );
}

function ExportForm({ onClose, graphName, doc: fullDoc, viewDoc, auraMode = "none", dark, canvas, graphId, onSaved }: Omit<Props, "open">) {
  // Guardar una copia en la cuenta es opcional y está desactivado por defecto: por defecto nada sale del navegador.
  const [saveCopy, setSaveCopy] = useState(false);
  const filtered = viewDoc !== undefined && viewDoc !== fullDoc;
  // Con la vista filtrada se propone exportar lo que se ve; el grafo completo sigue siendo una opción.
  const [scope, setScope] = useState<"all" | "visible">(filtered ? "visible" : "all");
  const [halos, setHalos] = useState(true);
  const doc = filtered && scope === "visible" ? viewDoc : fullDoc;
  const viewNote = filtered && scope === "visible" ? `Vista filtrada: ${viewDoc.nodes.length} de ${fullDoc.nodes.length} entidades` : undefined;
  const [options, setOptions] = useState<ExportOptions>(() => defaultExportOptions(graphName, dark));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  useEffect(() => () => abortRef.current?.abort(), []);

  const backgrounds: Background[] = options.format === "png" ? ["white", "dark", "transparent"] : ["white", "dark"];
  // Si el formato elegido no admite el fondo actual, se vuelve a uno válido.
  const background: Background = backgrounds.includes(options.background) ? options.background : "white";
  const tooBigForEditable = options.format === "pptx-editable" && (doc.nodes.length > PPTX_EDITABLE_LIMITS.maxNodes || doc.edges.length > PPTX_EDITABLE_LIMITS.maxEdges);
  const liveNeedsGraph = options.format === "pptx-live" && !graphId;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let liveShare: LiveShare | undefined;
      if (options.format === "pptx-live") {
        if (!graphId) throw new Error("El PowerPoint interactivo necesita un grafo guardado.");
        const created = await createShare(graphId, 7, controller.signal);
        liveShare = { url: buildShareUrl(window.location.origin, created.token), expiresAt: new Date(created.share.expiresAt) };
      }
      const result = await runExport({
        doc,
        graphName,
        options: { ...options, background },
        livePositions: canvas.current?.getPositions() ?? null,
        auraMode: halos && options.format !== "pptx-editable" ? auraMode : "none",
        ...(viewNote ? { viewNote } : {}),
        ...(graphId ? { imageUrl: (n) => (n.imageId ? graphImageUrl(graphId, n.imageId) : undefined) } : {}),
        ...(liveShare ? { liveShare } : {}),
        signal: controller.signal,
      });
      downloadBytes(result.bytes, result.mime, result.fileName);
      const description = result.notes.join(" ") || undefined;
      if (saveCopy && graphId) {
        // La descarga ya se hizo: si la copia falla, no se pierde nada y se avisa con el motivo.
        try {
          const saved = await uploadExport(graphId, result.bytes, result.mime, result.fileName, controller.signal);
          onSaved?.(saved);
          toast.success(`Se descargó «${result.fileName}» y se guardó una copia en Exportaciones.`, { description });
        } catch (uploadError) {
          if (uploadError instanceof DOMException && uploadError.name === "AbortError") return;
          toast.warning(`Se descargó «${result.fileName}», pero no se pudo guardar la copia en tu cuenta.`, { description: describeError(uploadError) });
        }
      } else {
        toast.success(`Se descargó «${result.fileName}».`, { description });
      }
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof EmptyGraphError || err instanceof ExportTooLargeError) setError(err.message);
      else setError(`No se pudo exportar: ${err instanceof Error ? err.message : "error desconocido"}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Exportar grafo</DialogTitle>
        <DialogDescription>
          Se genera en tu navegador y se descarga en tu equipo: los datos del grafo no se envían a ningún servicio externo. Se mantiene la disposición que ves
          ahora. Si lo eliges, también puedes guardar una copia privada en tu cuenta.
        </DialogDescription>
      </DialogHeader>

      {filtered && (
        <SelectField label="Qué exportar" value={scope} onChange={(e) => setScope(e.target.value as "all" | "visible")}>
          <option value="visible">Solo lo visible ({viewDoc.nodes.length} de {fullDoc.nodes.length} entidades)</option>
          <option value="all">Todo el grafo ({fullDoc.nodes.length} entidades)</option>
        </SelectField>
      )}

      <SelectField label="Formato" value={options.format} onChange={(e) => set("format", e.target.value as ExportFormat)}>
        {EXPORT_FORMATS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABELS[f]}
          </option>
        ))}
      </SelectField>

      <TextField label="Nombre del archivo" value={options.fileName} maxLength={80} onChange={(e) => set("fileName", e.target.value)} hint="Sin extensión." />

      {isImage(options.format) && (
        <SelectField label="Proporción" value={options.aspect} onChange={(e) => set("aspect", e.target.value as ExportOptions["aspect"])}>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {ASPECT_LABELS[a]}
            </option>
          ))}
        </SelectField>
      )}

      {options.format === "pdf" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Tamaño de página" value={options.pageSize} onChange={(e) => set("pageSize", e.target.value as ExportOptions["pageSize"])}>
            {PAGE_SIZES.map((p) => (
              <option key={p} value={p}>
                {PAGE_LABELS[p]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Orientación" value={options.orientation} onChange={(e) => set("orientation", e.target.value as ExportOptions["orientation"])}>
            <option value="auto">Automática (según el grafo)</option>
            <option value="landscape">Horizontal</option>
            <option value="portrait">Vertical</option>
          </SelectField>
        </div>
      )}

      {usesRaster(options.format) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Resolución" value={String(options.resolution)} onChange={(e) => set("resolution", Number(e.target.value) as ExportOptions["resolution"])}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {RESOLUTION_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Fondo" value={background} onChange={(e) => set("background", e.target.value as Background)}>
            {backgrounds.map((b) => (
              <option key={b} value={b}>
                {BACKGROUND_LABELS[b]}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      {auraMode !== "none" && options.format !== "pptx-editable" && <Check label={`Incluir halos (${AURA_MODE_LABELS[auraMode].toLocaleLowerCase("es")})`} checked={halos} onChange={setHalos} />}
      <Check label="Etiquetas de las relaciones (tipo o nombre de cada relación)" checked={options.edgeLabels} onChange={(v) => set("edgeLabels", v)} />

      {hasDocumentOptions(options.format) && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Incluir en el documento</legend>
          <Check label="Título" checked={options.includeTitle} onChange={(v) => set("includeTitle", v)} />
          <Check label="Fecha de exportación" checked={options.includeDate} onChange={(v) => set("includeDate", v)} />
          <Check label="Leyenda (tipos de entidad y naturaleza de las relaciones)" checked={options.includeLegend} onChange={(v) => set("includeLegend", v)} />
        </fieldset>
      )}

      {options.format === "pptx-editable" && auraMode !== "none" && <p className="text-xs text-muted-foreground">PowerPoint editable no incluye los halos; usa PDF, imagen o PowerPoint con imagen para verlos.</p>}
      {options.format === "pptx-image" && <p className="text-xs text-muted-foreground">La imagen se inserta tal cual: no se puede editar entidad por entidad. Para eso usa «PowerPoint editable».</p>}
      {options.format === "pptx-live" && (
        <p className="text-xs text-muted-foreground">
          Se crea un enlace de solo lectura (7 días) y un PowerPoint con la vista previa y la URL. El gráfico vivo se ve con el
          complemento «Web Viewer» de PowerPoint: hace falta que A-Link sea alcanzable por HTTPS con un certificado de
          confianza. El archivo no contiene ZoomCharts ejecutable. El token del enlace no se puede volver a consultar.
        </p>
      )}
      {liveNeedsGraph && (
        <p role="alert" className="text-sm text-destructive">
          El PowerPoint interactivo necesita un grafo guardado (con identificador) para crear el enlace.
        </p>
      )}
      {options.format === "pptx-editable" && (
        <p className="text-xs text-muted-foreground">
          Cada entidad es una forma editable y cada relación una línea (con su trazo y flechas). Las líneas no quedan «pegadas» a las formas: si mueves una forma
          en PowerPoint, su línea no la sigue. Máximo {PPTX_EDITABLE_LIMITS.maxNodes} entidades y {PPTX_EDITABLE_LIMITS.maxEdges} relaciones.
        </p>
      )}
      {tooBigForEditable && (
        <p role="alert" className="text-sm text-destructive">
          Este grafo ({doc.nodes.length} entidades, {doc.edges.length} relaciones) supera el máximo para PowerPoint editable. Elige PowerPoint con imagen o PDF.
        </p>
      )}

      {graphId && (
        <div className="grid gap-1">
          <Check label="Guardar una copia en mi cuenta (Exportaciones)" checked={saveCopy} onChange={setSaveCopy} />
          <p className="pl-6 text-xs text-muted-foreground">
            Opcional. La copia se guarda en el almacenamiento privado de A-Link, solo tú puedes verla y descargarla, y puedes eliminarla cuando quieras.
          </p>
        </div>
      )}

      <FormError message={error} />

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            abortRef.current?.abort();
            onClose();
          }}
        >
          {busy ? "Cancelar" : "Cerrar"}
        </Button>
        <Button type="submit" disabled={busy || doc.nodes.length === 0 || tooBigForEditable || liveNeedsGraph}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {busy ? "Generando…" : "Exportar"}
        </Button>
      </DialogFooter>
      {doc.nodes.length === 0 && <p className="text-xs text-muted-foreground">El grafo está vacío: añade entidades para poder exportarlo.</p>}
    </form>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 rounded border-input accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
