import type { PDFFont } from "pdf-lib";
import { PAGE_POINTS, type PageSize } from "./export-options";
import type { Legend } from "./legend";

export interface PdfPlanInput {
  pageSize: PageSize;
  orientation: "auto" | "landscape" | "portrait";
  /** Proporción ancho/alto del grafo; decide la orientación en `auto`. */
  contentAspect: number;
  title: string;
  date: Date;
  includeTitle: boolean;
  includeDate: boolean;
  includeLegend: boolean;
  /** Nota breve junto a la fecha (p. ej. «Vista filtrada: 3 de 10 entidades»). */
  note?: string;
  legend: Legend;
}

export interface PdfImage {
  bytes: Uint8Array;
  kind: "png" | "jpeg";
}

export interface PdfPlan {
  /** Proporción (ancho/alto) del hueco para la imagen: la imagen se genera con esta proporción y lo llena. */
  imageAspect: number;
  pageWidth: number;
  pageHeight: number;
  finish(image: PdfImage): Promise<Uint8Array>;
}

const MARGIN = 36;
const TITLE_SIZE = 16;
const DATE_SIZE = 9;
const LEGEND_SIZE = 8.5;
const LEGEND_LINE = 15;
const GAP = 10;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0.4, 0.4, 0.4];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

/**
 * Fuente estándar (Helvetica, WinAnsi): cubre el español, pero no todo Unicode. Los caracteres que no puede
 * representar (p. ej. emojis o alfabetos no latinos en el título) se sustituyen por «?» en lugar de hacer fallar
 * la exportación. Los controles se eliminan.
 */
export function sanitizeForFont(text: string, supported: ReadonlySet<number>): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || cp === 127) out += " ";
    else out += supported.has(cp) ? ch : "?";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Recorta un texto a un ancho máximo añadiendo «…» (en WinAnsi) si no cabe. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

interface LegendItem {
  kind: "type" | "evidence";
  label: string;
  width: number;
  color?: string;
  dash?: readonly number[];
}

/**
 * Prepara el PDF: fija el tamaño de página y calcula el hueco de la imagen ANTES de generarla, de modo que la
 * imagen salga con la proporción exacta del hueco y lo llene sin deformarse.
 */
export async function planPdf(input: PdfPlanInput): Promise<PdfPlan> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set<number>(regular.getCharacterSet());

  const [pw, ph] = PAGE_POINTS[input.pageSize];
  const landscape = input.orientation === "landscape" || (input.orientation === "auto" && input.contentAspect >= 1);
  const pageWidth = landscape ? ph : pw;
  const pageHeight = landscape ? pw : ph;
  const contentWidth = pageWidth - 2 * MARGIN;

  const title = sanitizeForFont(input.title, supported) || "Grafo";
  const dateText = new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(input.date);
  // Texto de la derecha de la cabecera: nota de vista (si la hay) y fecha (si se pide).
  const metaText = [input.note ? sanitizeForFont(input.note, supported) : "", input.includeDate ? dateText : ""].filter(Boolean).join(" · ");
  const hasMeta = metaText !== "";

  // --- Leyenda: se reparte en líneas según el ancho disponible -------------------------------------------------
  const lines: Array<{ heading?: string; items: LegendItem[] }> = [];
  // Columna de cabeceras común («Entidades:» y «Relaciones:» alinean sus elementos).
  const headingColumn = bold.widthOfTextAtSize("Relaciones:", LEGEND_SIZE) + 8;
  if (input.includeLegend) {
    const swatch = 16;
    const sample = 30;
    const typeItems: LegendItem[] = input.legend.types.map((t) => ({
      kind: "type",
      label: sanitizeForFont(`${t.name} (${t.count})`, supported),
      color: t.color,
      width: swatch + regular.widthOfTextAtSize(sanitizeForFont(`${t.name} (${t.count})`, supported), LEGEND_SIZE) + 14,
    }));
    const evItems: LegendItem[] = input.legend.evidence.map((e) => ({
      kind: "evidence",
      label: sanitizeForFont(`${e.name} (${e.count})`, supported),
      dash: e.dash,
      width: sample + 6 + regular.widthOfTextAtSize(sanitizeForFont(`${e.name} (${e.count})`, supported), LEGEND_SIZE) + 14,
    }));
    const wrap = (heading: string, items: LegendItem[]) => {
      if (items.length === 0) return;
      let current: LegendItem[] = [];
      let used = headingColumn;
      let first = true;
      for (const item of items) {
        if (used + item.width > contentWidth && current.length > 0) {
          lines.push({ ...(first ? { heading } : {}), items: current });
          first = false;
          current = [];
          used = headingColumn;
        }
        current.push(item);
        used += item.width;
      }
      if (current.length > 0) lines.push({ ...(first ? { heading } : {}), items: current });
    };
    wrap("Entidades:", typeItems);
    wrap("Relaciones:", evItems);
  }
  const legendHeight = lines.length > 0 ? lines.length * LEGEND_LINE + GAP : 0;

  const headerHeight = (input.includeTitle ? TITLE_SIZE + 6 : 0) + (hasMeta && !input.includeTitle ? DATE_SIZE + 6 : 0) + (input.includeTitle || hasMeta ? GAP : 0);
  const boxX = MARGIN;
  const boxTop = pageHeight - MARGIN - headerHeight;
  const boxBottom = MARGIN + legendHeight;
  const boxW = contentWidth;
  const boxH = Math.max(80, boxTop - boxBottom);

  return {
    imageAspect: boxW / boxH,
    pageWidth,
    pageHeight,
    async finish(image) {
      pdf.setTitle(title);
      pdf.setProducer("A-Link");
      pdf.setCreator("A-Link");
      pdf.setCreationDate(input.date);
      pdf.setModificationDate(input.date);

      const page = pdf.addPage([pageWidth, pageHeight]);
      const ink = rgb(0.06, 0.09, 0.16);
      const muted = rgb(0.4, 0.45, 0.52);

      // Cabecera
      if (input.includeTitle) {
        const shownMeta = hasMeta ? fit(metaText, regular, DATE_SIZE, contentWidth * 0.55) : "";
        const dateW = hasMeta ? regular.widthOfTextAtSize(shownMeta, DATE_SIZE) + 12 : 0;
        page.drawText(fit(title, bold, TITLE_SIZE, contentWidth - dateW), { x: MARGIN, y: pageHeight - MARGIN - TITLE_SIZE, size: TITLE_SIZE, font: bold, color: ink });
        if (hasMeta) page.drawText(shownMeta, { x: pageWidth - MARGIN - (dateW - 12), y: pageHeight - MARGIN - TITLE_SIZE, size: DATE_SIZE, font: regular, color: muted });
      } else if (hasMeta) {
        page.drawText(fit(metaText, regular, DATE_SIZE, contentWidth), { x: MARGIN, y: pageHeight - MARGIN - DATE_SIZE, size: DATE_SIZE, font: regular, color: muted });
      }

      // Imagen: llena el hueco (tiene su misma proporción) y se centra por si difiere un poco.
      const img = image.kind === "png" ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = boxX + (boxW - w) / 2;
      const y = boxBottom + (boxH - h) / 2;
      page.drawImage(img, { x, y, width: w, height: h });
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 0.5 });

      // Leyenda (vectorial: los trazos de certeza se dibujan igual que en el lienzo)
      let ly = MARGIN + (lines.length - 1) * LEGEND_LINE + 2;
      for (const line of lines) {
        let lx = MARGIN;
        if (line.heading) page.drawText(line.heading, { x: lx, y: ly, size: LEGEND_SIZE, font: bold, color: ink });
        lx += headingColumn;
        for (const item of line.items) {
          if (item.kind === "type") {
            const [r, g, b] = hexToRgb(item.color ?? "#64748b");
            page.drawCircle({ x: lx + 4, y: ly + 3, size: 4, color: rgb(r, g, b) });
            page.drawText(item.label, { x: lx + 13, y: ly, size: LEGEND_SIZE, font: regular, color: ink });
          } else {
            const dash = item.dash ?? [];
            page.drawLine({
              start: { x: lx, y: ly + 3 },
              end: { x: lx + 28, y: ly + 3 },
              thickness: 1.4,
              color: rgb(0.39, 0.45, 0.55),
              ...(dash.length > 0 ? { dashArray: dash.map((d) => d * 0.45), dashPhase: 0 } : {}),
            });
            page.drawText(item.label, { x: lx + 34, y: ly, size: LEGEND_SIZE, font: regular, color: ink });
          }
          lx += item.width;
        }
        ly -= LEGEND_LINE;
      }

      page.drawText("Generado con A-Link", { x: MARGIN, y: 16, size: 7, font: regular, color: muted });
      return pdf.save({ useObjectStreams: true });
    },
  };
}
