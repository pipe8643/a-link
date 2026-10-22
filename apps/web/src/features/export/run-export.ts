import type { GraphSnapshot } from "@a-link/shared";
import type { AuraMode } from "../editor/auras";
import {
  FORMAT_EXTENSION,
  FORMAT_MIME,
  type ExportOptions,
  computeOutputSize,
  exportOptionsSchema,
  normalizeOptions,
  safeFileName,
  sizeForRatio,
} from "./export-options";
import { type Positions, contentAspect, resolvePositions } from "./layout";
import { buildLegend } from "./legend";
import { planPdf } from "./pdf";
import { buildPptxEditable, buildPptxImage, buildPptxLive, type LiveShare, pptxImageAspect } from "./pptx";
import { type ImageUrlResolver } from "../editor/zoom-data";
import { loadMaskedNodeImages } from "./node-images";
import { renderGraphImage } from "./render-image";

export class EmptyGraphError extends Error {
  constructor() {
    super("El grafo no tiene entidades: no hay nada que exportar.");
    this.name = "EmptyGraphError";
  }
}

export interface ExportInput {
  doc: GraphSnapshot;
  graphName: string;
  options: ExportOptions;
  /** Posiciones que muestra el lienzo ahora mismo (si está disponible). */
  livePositions?: Positions | null;
  /** Halos que se ven en el editor; se dibujan en las imágenes (el PowerPoint editable no los lleva). */
  auraMode?: AuraMode;
  /** URL de la imagen de cada entidad (mismo origen). Sin ella, las entidades se exportan solo con su icono. */
  imageUrl?: ImageUrlResolver;
  /** Aviso visible en PDF/PowerPoint cuando no se exporta el grafo completo (p. ej. «Vista filtrada: 3 de 10 entidades»). */
  viewNote?: string;
  /** Enlace de solo lectura (solo `pptx-live`). Lo crea el diálogo de exportar; aquí no se llama a la API. */
  liveShare?: LiveShare;
  signal?: AbortSignal;
  now?: Date;
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
  /** Avisos para mostrar al usuario (p. ej. resolución reducida). */
  notes: string[];
}

/**
 * Genera el fichero de exportación COMPLETAMENTE EN EL NAVEGADOR. No hay ninguna llamada a nuestro servidor ni a
 * terceros con datos del grafo: la imagen sale de una instancia local de ZoomCharts y PDF/PPTX se montan con
 * `pdf-lib` y `pptxgenjs` en memoria. (La Fase 7 añadirá, de forma opcional, guardar una copia en el almacenamiento
 * privado del propio usuario.)
 */
export async function runExport(input: ExportInput): Promise<ExportResult> {
  const options = normalizeOptions(exportOptionsSchema.parse(input.options));
  const { doc, graphName, signal } = input;
  if (doc.nodes.length === 0) throw new EmptyGraphError();

  const now = input.now ?? new Date();
  const positions = resolvePositions(doc, input.livePositions);
  const legend = buildLegend(doc);
  const aspect = contentAspect(positions);
  const notes: string[] = [];
  const dark = options.theme === "dark";
  const title = graphName.trim() || "Grafo";
  const common = {
    title,
    date: now,
    includeTitle: options.includeTitle,
    includeDate: options.includeDate,
    includeLegend: options.includeLegend,
    edgeLabels: options.edgeLabels,
    ...(input.viewNote ? { note: input.viewNote } : {}),
    legend,
  };
  const auraMode = input.auraMode ?? "none";
  const imageUrl = input.imageUrl;
  const fileName = `${safeFileName(options.fileName, safeFileName(graphName))}.${FORMAT_EXTENSION[options.format]}`;
  const finish = (bytes: Uint8Array): ExportResult => ({ bytes, mime: FORMAT_MIME[options.format], fileName, notes });

  switch (options.format) {
    case "png":
    case "jpeg": {
      const size = computeOutputSize(options.aspect, options.resolution, aspect);
      if (size.reduced) notes.push(`Se redujo la resolución a ${size.pixelWidth}×${size.pixelHeight} px (límite del navegador).`);
      const img = await renderGraphImage({ doc, positions, width: size.width, height: size.height, scale: size.scale, format: options.format, background: options.background, dark, edgeLabels: options.edgeLabels, auraMode, ...(imageUrl ? { imageUrl } : {}), ...(signal ? { signal } : {}) });
      return finish(img.bytes);
    }
    case "pdf": {
      const plan = await planPdf({ pageSize: options.pageSize, orientation: options.orientation, contentAspect: aspect, ...common });
      const size = sizeForRatio(plan.imageAspect, options.resolution);
      if (size.reduced) notes.push(`Se redujo la resolución de la imagen a ${size.pixelWidth}×${size.pixelHeight} px (límite del navegador).`);
      const img = await renderGraphImage({ doc, positions, width: size.width, height: size.height, scale: size.scale, format: "png", background: options.background === "dark" ? "dark" : "white", dark, edgeLabels: options.edgeLabels, auraMode, ...(imageUrl ? { imageUrl } : {}), ...(signal ? { signal } : {}) });
      return finish(await plan.finish({ bytes: img.bytes, kind: "png" }));
    }
    case "pptx-image": {
      const size = sizeForRatio(pptxImageAspect(common), options.resolution);
      if (size.reduced) notes.push(`Se redujo la resolución de la imagen a ${size.pixelWidth}×${size.pixelHeight} px (límite del navegador).`);
      const img = await renderGraphImage({ doc, positions, width: size.width, height: size.height, scale: size.scale, format: "png", background: options.background === "dark" ? "dark" : "white", dark, edgeLabels: options.edgeLabels, auraMode, ...(imageUrl ? { imageUrl } : {}), ...(signal ? { signal } : {}) });
      return finish(await buildPptxImage(common, img));
    }
    case "pptx-editable": {
      return finish(await buildPptxEditable(common, doc, positions, await loadMaskedNodeImages(doc, imageUrl, signal)));
    }
    case "pptx-live": {
      if (!input.liveShare) throw new Error("Falta el enlace de solo lectura para el PowerPoint interactivo.");
      const liveCommon = { ...common, liveBar: true as const };
      const size = sizeForRatio(pptxImageAspect(liveCommon), options.resolution);
      if (size.reduced) notes.push(`Se redujo la resolución de la imagen a ${size.pixelWidth}×${size.pixelHeight} px (límite del navegador).`);
      let preview: { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number } | null = null;
      try {
        const img = await renderGraphImage({ doc, positions, width: size.width, height: size.height, scale: size.scale, format: "png", background: options.background === "dark" ? "dark" : "white", dark, edgeLabels: options.edgeLabels, auraMode, ...(imageUrl ? { imageUrl } : {}), ...(signal ? { signal } : {}) });
        preview = { bytes: img.bytes, mime: img.mime, width: img.width, height: img.height };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        notes.push("No se pudo incluir la vista previa del lienzo; el enlace interactivo sí está en el archivo.");
      }
      return finish(await buildPptxLive(common, preview, input.liveShare));
    }
  }
}
