import { ENTITY_CATALOG, RELATIONSHIP_LABELS_ES, type EntityShape, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { SHAPES } from "../editor/shapes";
import { NODE_RADIUS } from "../editor/zoom-data";
import { type Legend } from "./legend";
import { type Positions, boundsOf } from "./layout";

/** Un PowerPoint con decenas de miles de formas es inmanejable: por encima de esto se propone imagen o PDF. */
export const PPTX_EDITABLE_LIMITS = { maxNodes: 400, maxEdges: 1500 } as const;

export class ExportTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportTooLargeError";
  }
}

export function assertEditableSize(doc: GraphSnapshot): void {
  if (doc.nodes.length > PPTX_EDITABLE_LIMITS.maxNodes || doc.edges.length > PPTX_EDITABLE_LIMITS.maxEdges) {
    throw new ExportTooLargeError(
      `El grafo es demasiado grande para un PowerPoint editable (máximo ${PPTX_EDITABLE_LIMITS.maxNodes} entidades y ${PPTX_EDITABLE_LIMITS.maxEdges} relaciones). Usa «PowerPoint con imagen» o PDF.`,
    );
  }
}

// Diapositiva panorámica 16:9 en pulgadas.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.4;
const TITLE_H = 0.5;
/** Alto reservado a la leyenda: hasta dos filas de tipos de entidad y una de naturaleza de las relaciones. */
const LEGEND_ROW = 0.24;
const LEGEND_H = LEGEND_ROW * 3 + 0.06;

export interface PptxCommon {
  title: string;
  date: Date;
  includeTitle: boolean;
  includeDate: boolean;
  includeLegend: boolean;
  /** Nota breve junto a la fecha (p. ej. «Vista filtrada: 3 de 10 entidades»). */
  note?: string;
  /** Rotular cada relación con su etiqueta (o, si no la tiene, con el nombre de su tipo), como hace el lienzo. */
  edgeLabels: boolean;
  legend: Legend;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alto del recuadro con el hipervínculo al visor vivo (PowerPoint interactivo). */
const LIVE_BAR_H = 0.5;

/** Hueco de la diapositiva destinado al grafo (la imagen o las formas), según qué elementos se incluyan. */
export function pptxContentBox(o: Pick<PptxCommon, "includeTitle" | "includeDate" | "includeLegend" | "note"> & { liveBar?: boolean }): Box {
  const top = MARGIN + (o.includeTitle || o.includeDate || !!o.note ? TITLE_H + 0.1 : 0);
  const bottom = SLIDE_H - MARGIN - (o.includeLegend ? LEGEND_H + 0.1 : 0) - (o.liveBar ? LIVE_BAR_H + 0.08 : 0);
  return { x: MARGIN, y: top, w: SLIDE_W - 2 * MARGIN, h: bottom - top };
}

export const pptxImageAspect = (o: Pick<PptxCommon, "includeTitle" | "includeDate" | "includeLegend" | "note"> & { liveBar?: boolean }) => {
  const b = pptxContentBox(o);
  return b.w / b.h;
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

const hex = (c: string) => c.replace("#", "").toUpperCase();

type PptxModule = typeof import("pptxgenjs");
type Pptx = InstanceType<PptxModule["default"]>;
type Slide = ReturnType<Pptx["addSlide"]>;

async function newPresentation(common: PptxCommon): Promise<{ pptx: Pptx; slide: Slide }> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  // Metadatos mínimos: sin usuario ni correo (el valor por defecto de la librería sería «PptxGenJS»).
  pptx.author = "A-Link";
  pptx.company = "A-Link";
  pptx.title = common.title;
  pptx.subject = "";
  pptx.revision = "1";
  const slide = pptx.addSlide();

  const dateText = new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(common.date);
  const metaText = [common.note ?? "", common.includeDate ? dateText : ""].filter(Boolean).join(" · ");
  const hasMeta = metaText !== "";
  const metaW = common.note ? 5.5 : 2.5;
  if (common.includeTitle) {
    slide.addText(common.title, { x: MARGIN, y: MARGIN, w: SLIDE_W - 2 * MARGIN - (hasMeta ? metaW + 0.1 : 0), h: TITLE_H, fontFace: "Calibri", fontSize: 22, bold: true, color: "0F172A", valign: "middle", fit: "shrink" });
  }
  if (hasMeta) {
    slide.addText(metaText, { x: common.includeTitle ? SLIDE_W - MARGIN - metaW : MARGIN, y: MARGIN, w: metaW, h: TITLE_H, fontFace: "Calibri", fontSize: 11, color: "64748B", align: common.includeTitle ? "right" : "left", valign: "middle" });
  }
  if (common.includeLegend) addLegend(pptx, slide, common.legend);
  return { pptx, slide };
}

function addLegend(pptx: Pptx, slide: Slide, legend: Legend): void {
  const maxX = SLIDE_W - MARGIN;
  const textW = (s: string) => Math.min(2.6, 0.072 * s.length + 0.12);
  let y = SLIDE_H - MARGIN - LEGEND_H;
  let x = MARGIN;
  // Tipos de entidad: se reparten en filas (con los 10 tipos hacen falta dos).
  for (const t of legend.types) {
    const label = `${t.name} (${t.count})`;
    const w = textW(label);
    const itemW = 0.2 + w + 0.2;
    if (x > MARGIN && x + itemW > maxX) {
      x = MARGIN;
      y += LEGEND_ROW;
    }
    slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.05, w: 0.16, h: 0.16, fill: { color: hex(t.color) }, line: { color: hex(t.color), width: 0.5 } });
    slide.addText(label, { x: x + 0.2, y, w, h: LEGEND_ROW - 0.02, fontFace: "Calibri", fontSize: 10, color: "0F172A", valign: "middle", margin: 0 });
    x += itemW;
  }
  // Naturaleza de las relaciones: fila propia.
  if (legend.types.length > 0) y += LEGEND_ROW;
  let x2 = MARGIN;
  for (const e of legend.evidence) {
    const label = `${e.name} (${e.count})`;
    const w = textW(label);
    slide.addShape(pptx.ShapeType.line, { x: x2, y: y + LEGEND_ROW / 2, w: 0.4, h: 0, line: { color: "64748B", width: 1.5, dashType: e.dash.length === 0 ? "solid" : e.evidence === "hypothesis" ? "dash" : "sysDot" } });
    slide.addText(label, { x: x2 + 0.45, y, w, h: LEGEND_ROW - 0.02, fontFace: "Calibri", fontSize: 9, color: "334155", valign: "middle", margin: 0 });
    x2 += 0.45 + w + 0.25;
  }
}

async function output(pptx: Pptx): Promise<Uint8Array> {
  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Uint8Array(out);
}

/** PowerPoint con la imagen del grafo (no editable nodo a nodo). */
export async function buildPptxImage(common: PptxCommon, image: { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number }): Promise<Uint8Array> {
  const { pptx, slide } = await newPresentation(common);
  const box = pptxContentBox(common);
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  slide.addImage({
    data: `${image.mime};base64,${toBase64(image.bytes)}`,
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
    altText: `Grafo «${common.title}»`,
  });
  return output(pptx);
}

export interface LiveShare {
  url: string;
  expiresAt: Date;
}

const LIVE_STEPS = [
  "Este archivo NO contiene un gráfico ZoomCharts ejecutable: PowerPoint no puede dibujarlo sin un servidor.",
  "Para verlo en vivo: Insertar → Complementos de Office → busca «Web Viewer» → inserta el complemento.",
  "Pega la URL completa (incluido lo que va detrás de #) en Web Viewer. Sin el fragmento el visor no autoriza.",
  "Hace falta red y un certificado de confianza. El autofirmado de localhost suele fallar en Office: usa un origen https público o instala el certificado.",
  "Si revocas el enlace o caduca, la diapositiva incrustada deja de cargar. Quien tenga la URL ve el grafo guardado en ese momento (no una foto congelada), sin notas ni campos sensibles.",
];

/**
 * PowerPoint «interactivo»: vista previa raster + hipervínculo a un visor de solo lectura (`/s#token`) e
 * instrucciones para el complemento Web Viewer. El .pptx no ejecuta ZoomCharts por sí solo.
 */
export async function buildPptxLive(common: PptxCommon, image: { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number } | null, live: LiveShare): Promise<Uint8Array> {
  const withBar = { ...common, liveBar: true as const };
  const { pptx, slide } = await newPresentation(withBar);
  const box = pptxContentBox(withBar);
  if (image) {
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    slide.addImage({
      data: `${image.mime};base64,${toBase64(image.bytes)}`,
      x: box.x + (box.w - w) / 2,
      y: box.y + (box.h - h) / 2,
      w,
      h,
      altText: `Vista previa de «${common.title}»`,
    });
  } else {
    slide.addText("No se pudo generar la vista previa del lienzo. Abre el enlace para ver el grafo en vivo.", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontFace: "Calibri",
      fontSize: 16,
      color: "64748B",
      align: "center",
      valign: "middle",
    });
  }
  const barY = box.y + box.h + 0.08;
  const expiry = new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short" }).format(live.expiresAt);
  slide.addText(`Abrir el gráfico interactivo · válido hasta ${expiry}`, {
    x: box.x,
    y: barY,
    w: box.w,
    h: LIVE_BAR_H - 0.08,
    fontFace: "Calibri",
    fontSize: 14,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fill: { color: "1D4ED8" },
    hyperlink: { url: live.url },
  });

  const how = pptx.addSlide();
  how.addText("Cómo incrustarlo en PowerPoint", { x: MARGIN, y: MARGIN, w: SLIDE_W - 2 * MARGIN, h: 0.5, fontFace: "Calibri", fontSize: 22, bold: true, color: "0F172A" });
  how.addText(
    LIVE_STEPS.map((s, i) => ({ text: `${i + 1}. ${s}`, options: { breakLine: true, paraSpaceAfter: 10 } })),
    { x: MARGIN, y: MARGIN + 0.6, w: SLIDE_W - 2 * MARGIN, h: 4.2, fontFace: "Calibri", fontSize: 14, color: "0F172A", valign: "top" },
  );
  how.addText(live.url, {
    x: MARGIN,
    y: SLIDE_H - MARGIN - 1.1,
    w: SLIDE_W - 2 * MARGIN,
    h: 0.55,
    fontFace: "Consolas",
    fontSize: 11,
    color: "1D4ED8",
    hyperlink: { url: live.url },
  });
  how.addText("Copia la URL completa, incluido el fragmento detrás de #. Sin él el visor no abre el grafo.", {
    x: MARGIN,
    y: SLIDE_H - MARGIN - 0.5,
    w: SLIDE_W - 2 * MARGIN,
    h: 0.4,
    fontFace: "Calibri",
    fontSize: 11,
    color: "64748B",
  });
  return output(pptx);
}

// --- PowerPoint editable ----------------------------------------------------------------------------------------

interface ShapeMap {
  type: (p: Pptx) => string;
  rotate?: number;
}

const PPT_SHAPE: Readonly<Record<EntityShape, ShapeMap>> = {
  circle: { type: (p) => p.ShapeType.ellipse },
  square: { type: (p) => p.ShapeType.rect },
  triangle: { type: (p) => p.ShapeType.triangle },
  hexagon: { type: (p) => p.ShapeType.hexagon },
  diamond: { type: (p) => p.ShapeType.diamond },
  rounded_rect: { type: (p) => p.ShapeType.roundRect },
  icon_bank: { type: (p) => p.ShapeType.homePlate, rotate: 270 }, // «casa»: pentágono apuntando hacia arriba
  icon_document: { type: (p) => p.ShapeType.flowChartDocument },
  icon_location: { type: (p) => p.ShapeType.teardrop, rotate: 135 }, // gota apuntando hacia abajo
  custom: { type: (p) => p.ShapeType.ellipse },
};

const DASH = { recorded: "solid", hypothesis: "dash", observation: "sysDot" } as const;

function nodeHalfSize(node: GraphNodeData, scale: number): { hw: number; hh: number } {
  const geo = SHAPES[ENTITY_CATALOG[node.type].shape];
  const min = 0.14; // pulgadas: por debajo no se distingue la forma
  return { hw: Math.max(min, NODE_RADIUS * geo.hwFactor * scale), hh: Math.max(min, NODE_RADIUS * geo.hhFactor * scale) };
}

/**
 * PowerPoint con formas y líneas NATIVAS (cada entidad es una forma editable con su color y nombre; cada
 * relación, una línea con su trazo y flechas). Limitación honesta: PptxGenJS no crea conectores «pegados» a las
 * formas, así que al mover una forma en PowerPoint su línea no la sigue.
 */
export async function buildPptxEditable(common: PptxCommon, doc: GraphSnapshot, positions: Positions, nodeImages: ReadonlyMap<string, string> = new Map()): Promise<Uint8Array> {
  assertEditableSize(doc);
  const { pptx, slide } = await newPresentation(common);
  const box = pptxContentBox(common);

  // Escala de escena → pulgadas, conservando la proporción y dejando margen para formas y etiquetas.
  const b = boundsOf(positions, NODE_RADIUS * 2.2);
  const scale = b.width > 0 && b.height > 0 ? Math.min(box.w / b.width, box.h / b.height) : 0.01;
  const offX = box.x + (box.w - b.width * scale) / 2;
  const offY = box.y + (box.h - b.height * scale) / 2;
  const at = (id: string) => {
    const p = positions.get(id) ?? { x: 0, y: 0 };
    return { x: offX + (p.x - b.minX) * scale, y: offY + (p.y - b.minY) * scale };
  };

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const sizeOf = new Map(doc.nodes.map((n) => [n.id, nodeHalfSize(n, scale)]));

  // Relaciones primero, para que las formas queden por encima de las líneas.
  const pairIndex = new Map<string, number>();
  const pairTotal = new Map<string, number>();
  const pairKey = (e: GraphEdgeData) => [e.sourceId, e.targetId].sort().join("|");
  for (const e of doc.edges) pairTotal.set(pairKey(e), (pairTotal.get(pairKey(e)) ?? 0) + 1);

  for (const e of doc.edges) {
    const s = byId.get(e.sourceId);
    const t = byId.get(e.targetId);
    if (!s || !t) continue;
    const key = pairKey(e);
    const idx = pairIndex.get(key) ?? 0;
    pairIndex.set(key, idx + 1);
    const total = pairTotal.get(key) ?? 1;

    const a = at(s.id);
    const c = at(t.id);
    let dx = c.x - a.x;
    let dy = c.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Relaciones paralelas entre el mismo par: se separan perpendicularmente.
    // La normal se calcula con una orientación canónica (la misma para A→B y B→A); si no, dos relaciones
    // opuestas entre el mismo par caerían exactamente en el mismo sitio.
    const flip = e.sourceId > e.targetId ? -1 : 1;
    const lane = (idx - (total - 1) / 2) * 0.22;
    const ox = -dy * flip * lane;
    const oy = dx * flip * lane;
    const sr = sizeOf.get(s.id)!;
    const tr = sizeOf.get(t.id)!;
    const x1 = a.x + dx * Math.max(sr.hw, sr.hh) + ox;
    const y1 = a.y + dy * Math.max(sr.hw, sr.hh) + oy;
    const x2 = c.x - dx * Math.max(tr.hw, tr.hh) + ox;
    const y2 = c.y - dy * Math.max(tr.hw, tr.hh) + oy;

    const direction = e.metadata.direction ?? "forward";
    const evidence = e.metadata.evidenceClass ?? "hypothesis";
    slide.addShape(pptx.ShapeType.line, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      flipH: x2 < x1,
      flipV: y2 < y1,
      line: {
        color: "64748B",
        width: 1.5,
        dashType: DASH[evidence],
        ...(direction === "none" ? {} : { endArrowType: "triangle" as const }),
        ...(direction === "both" ? { beginArrowType: "triangle" as const } : {}),
      },
    });

    const label = common.edgeLabels ? e.label || RELATIONSHIP_LABELS_ES[e.relationshipType] : "";
    if (label) {
      const w = Math.min(2.2, 0.075 * label.length + 0.25);
      slide.addText(label, {
        x: (x1 + x2) / 2 - w / 2,
        y: (y1 + y2) / 2 - 0.1,
        w,
        h: 0.2,
        fontFace: "Calibri",
        fontSize: 8,
        color: "334155",
        align: "center",
        valign: "middle",
        fill: { color: "FFFFFF" },
      });
    }
  }

  for (const n of doc.nodes) {
    const def = ENTITY_CATALOG[n.type];
    const map = PPT_SHAPE[def.shape];
    const { hw, hh } = sizeOf.get(n.id)!;
    const p = at(n.id);
    const rotated = map.rotate !== undefined;
    // Una forma girada ocupa una caja cuadrada del tamaño de su lado mayor.
    const w = rotated ? Math.max(hw, hh) * 2 : hw * 2;
    const h = rotated ? Math.max(hw, hh) * 2 : hh * 2;
    slide.addShape(map.type(pptx) as never, {
      x: p.x - w / 2,
      y: p.y - h / 2,
      w,
      h,
      fill: { color: hex(def.defaultColor) },
      line: { color: hex(def.defaultColor), width: 1, dashType: def.shape === "custom" ? "dash" : "solid" },
      ...(rotated ? { rotate: map.rotate } : {}),
    });
    // La imagen de la entidad (ya recortada a su forma, con transparencia) va encima de la forma nativa, que sigue debajo.
    const picture = nodeImages.get(n.id);
    if (picture) slide.addImage({ data: picture, x: p.x - hw, y: p.y - hh, w: hw * 2, h: hh * 2, altText: `Imagen de ${n.label}` });
    const labelW = Math.min(2.2, Math.max(0.9, 0.08 * n.label.length + 0.2));
    slide.addText(n.label, {
      x: p.x - labelW / 2,
      y: p.y + Math.max(hh, rotated ? h / 2 : 0) + 0.02,
      w: labelW,
      h: 0.32,
      fontFace: "Calibri",
      fontSize: 9,
      bold: true,
      color: "0F172A",
      align: "center",
      valign: "top",
      fit: "shrink",
    });
  }

  return output(pptx);
}
