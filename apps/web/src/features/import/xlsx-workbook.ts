import {
  EXCEL_DROPDOWN_PROMPTS,
  EXCEL_GRAPH_HEADERS,
  EXCEL_IMPORT_LIMITS,
  EXCEL_SHEETS,
  excelTemplateSheet,
  foldHeader,
  graphFromExcelSheet,
  type ExcelImportResult,
  type ExcelTable,
} from "@a-link/shared";
import JSZip from "jszip";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] as const;
const MAX_UNCOMPRESSED = 8 * 1024 * 1024;
const MAX_ENTRIES = 40;
const DATA_ROWS = 500;

export class ExcelFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelFileError";
  }
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** Comprueba extensión, peso y firma mágica ANTES de descomprimir. */
export function validateExcelFile(file: Pick<File, "name" | "size">, bytes: Uint8Array): void {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ExcelFileError("Usa un fichero .xlsx (Excel 2007 o posterior).");
  if (file.size === 0 || bytes.length === 0) throw new ExcelFileError("El archivo está vacío.");
  if (file.size > EXCEL_IMPORT_LIMITS.maxBytes || bytes.length > EXCEL_IMPORT_LIMITS.maxBytes) {
    throw new ExcelFileError("El Excel es demasiado grande (máximo 2 MB).");
  }
  if (startsWith(bytes, OLE_MAGIC)) throw new ExcelFileError("El formato .xls antiguo no se admite. Guarda el archivo como .xlsx.");
  if (!startsWith(bytes, ZIP_MAGIC)) throw new ExcelFileError("El archivo no es un Excel .xlsx válido.");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(ref: string): number {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function localTags(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagName("*")].filter((el) => el.localName === name);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new ExcelFileError("El Excel está dañado o no se puede leer.");
  return doc;
}

function textOf(el: Element | undefined): string {
  if (!el) return "";
  return (el.textContent ?? "").replace(/\r\n/g, "\n").trim();
}

function inlineCell(row: number, col: number, value: string, style?: number): string {
  if (value === "" && style === undefined) return "";
  const s = style !== undefined ? ` s="${style}"` : "";
  return `<c r="${colLetter(col)}${row}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function headerIndex(name: (typeof EXCEL_GRAPH_HEADERS)[number]): number {
  return EXCEL_GRAPH_HEADERS.indexOf(name);
}

function dataValidation(col: number, listCol: string, lastListRow: number, prompt: string): string {
  const letter = colLetter(col);
  return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" promptTitle="Lista" prompt="${xmlEscape(prompt)}" errorTitle="Valor no valido" error="Elige un valor de la lista." sqref="${letter}3:${letter}${DATA_ROWS + 2}"><formula1>${EXCEL_SHEETS.lists}!$${listCol}$1:$${listCol}$${lastListRow}</formula1></dataValidation>`;
}

function listSheetXml(columns: string[][]): string {
  const height = Math.max(0, ...columns.map((c) => c.length));
  const lastCol = colLetter(Math.max(0, columns.length - 1));
  const rows = [];
  for (let r = 0; r < height; r++) {
    const cells = columns.map((col, c) => (col[r] ? inlineCell(r + 1, c, col[r]!) : "")).join("");
    rows.push(`<row r="${r + 1}">${cells}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${Math.max(1, height)}"/><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function graphSheetXml(spec: ReturnType<typeof excelTemplateSheet>): string {
  const lastCol = colLetter(spec.headers.length - 1);
  const lastRow = spec.rows.length + 2;
  const headerRow = 2;
  const help = `<row r="1" ht="48" customHeight="1">${inlineCell(1, 0, spec.help, 1)}</row>`;
  const headers = `<row r="${headerRow}">${spec.headers.map((h, c) => inlineCell(headerRow, c, h, 2)).join("")}</row>`;
  const data = spec.rows.map((row, i) => `<row r="${i + 3}">${row.map((value, c) => inlineCell(i + 3, c, value)).join("")}</row>`).join("");
  const validations = [
    dataValidation(headerIndex("tipo"), "A", spec.lists.entityTypes.length, EXCEL_DROPDOWN_PROMPTS.tipo),
    dataValidation(headerIndex("tipo_enlace"), "B", spec.lists.relationTypes.length, EXCEL_DROPDOWN_PROMPTS.tipo_enlace),
    dataValidation(headerIndex("naturaleza"), "C", spec.lists.evidence.length, EXCEL_DROPDOWN_PROMPTS.naturaleza),
    dataValidation(headerIndex("direccion"), "D", spec.lists.directions.length, EXCEL_DROPDOWN_PROMPTS.direccion),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><tabColor rgb="FF4F46E5"/></sheetPr>
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>
<col min="1" max="1" width="12" customWidth="1"/>
<col min="2" max="2" width="24" customWidth="1"/>
<col min="3" max="3" width="22" customWidth="1"/>
<col min="4" max="4" width="22" customWidth="1"/>
<col min="5" max="5" width="14" customWidth="1"/>
<col min="6" max="6" width="14" customWidth="1"/>
<col min="7" max="7" width="22" customWidth="1"/>
<col min="8" max="8" width="16" customWidth="1"/>
<col min="9" max="9" width="18" customWidth="1"/>
<col min="10" max="10" width="16" customWidth="1"/>
</cols>
<sheetData>${help}${headers}${data}</sheetData>
<autoFilter ref="A${headerRow}:${lastCol}${headerRow}"/>
<mergeCells count="1"><mergeCell ref="A1:${lastCol}1"/></mergeCells>
<dataValidations count="4">${validations}</dataValidations>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
</styleSheet>`;

/** Genera la plantilla .xlsx: una hoja visible, listas desplegables, sin macros ni fórmulas. */
export async function buildExcelTemplate(): Promise<Uint8Array> {
  const spec = excelTemplateSheet();
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<sheets>
<sheet name="${EXCEL_SHEETS.graph}" sheetId="1" r:id="rId1"/>
<sheet name="${EXCEL_SHEETS.lists}" sheetId="2" r:id="rId2" state="hidden"/>
</sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", graphSheetXml(spec));
  zip.file("xl/worksheets/sheet2.xml", listSheetXml([spec.lists.entityTypes, spec.lists.relationTypes, spec.lists.evidence, spec.lists.directions]));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const excelTemplateFileName = "plantilla-grafo-a-link.xlsx";
export const excelTemplateMime = XLSX_MIME;

function loadSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  return localTags(doc, "si").map((si) => textOf(si));
}

function looksLikeHeader(values: string[]): boolean {
  const folded = new Set(values.map(foldHeader));
  const hasRef = ["ref", "id", "clave", "referencia"].some((n) => folded.has(n));
  const hasTipo = folded.has("tipo") || folded.has("type");
  const hasNombre = folded.has("nombre") || folded.has("name") || folded.has("label");
  return hasRef && hasTipo && hasNombre;
}

function readCell(c: Element, shared: string[]): string {
  const t = c.getAttribute("t");
  if (t === "inlineStr") return textOf(localTags(c, "t")[0]);
  if (t === "s") {
    const idx = Number(textOf(localTags(c, "v")[0]));
    return Number.isInteger(idx) ? (shared[idx] ?? "") : "";
  }
  if (t === "e") throw new ExcelFileError("El Excel contiene celdas con error.");
  return textOf(localTags(c, "v")[0]);
}

/** Solo fórmulas de celda (`<c><f>`). Las listas desplegables que Excel guarda como `<xm:f>` no cuentan. */
function hasCellFormulas(doc: Document): boolean {
  return localTags(doc, "f").some((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.localName === "c") return true;
    }
    return false;
  });
}

function sheetToTable(xml: string, shared: string[]): ExcelTable {
  const doc = parseXml(xml);
  if (hasCellFormulas(doc)) throw new ExcelFileError("El Excel no puede contener fórmulas. Copia los valores y vuelve a guardarlo.");
  let width = 0;
  const byRow = new Map<number, Map<number, string>>();
  for (const row of localTags(doc, "row")) {
    const rowNum = Number(row.getAttribute("r") ?? 0);
    const cells = new Map<number, string>();
    for (const c of localTags(row, "c")) {
      const i = colIndex(c.getAttribute("r") ?? "");
      if (i < 0) continue;
      width = Math.max(width, i + 1);
      cells.set(i, readCell(c, shared));
    }
    byRow.set(rowNum > 0 ? rowNum : byRow.size + 1, cells);
  }
  const ordered = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([n, cells]) => {
    const line: string[] = [];
    for (let i = 0; i < width; i++) line.push(cells.get(i) ?? "");
    return { n, line };
  });
  const headerAt = ordered.findIndex((r) => looksLikeHeader(r.line));
  if (headerAt < 0) return { headers: [], rows: [] };
  const header = ordered[headerAt]!;
  const headers = header.line.map((h) => h.trim());
  while (headers.length > 0 && headers.at(-1) === "") headers.pop();
  const rows = ordered
    .slice(headerAt + 1)
    .map((r) => headers.map((_, i) => (r.line[i] ?? "").trim()))
    .filter((row) => row.some((c) => c !== ""));
  return { headers, rows, headerRow: header.n };
}

async function readZip(bytes: Uint8Array): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new ExcelFileError("El Excel tiene una estructura no admitida.");
  let uncompressed = 0;
  for (const name of names) {
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) throw new ExcelFileError("El Excel está dañado.");
    const f = zip.files[name]!;
    if (f.dir) continue;
    const data = await f.async("uint8array");
    uncompressed += data.length;
    if (uncompressed > MAX_UNCOMPRESSED) throw new ExcelFileError("El Excel es demasiado grande una vez abierto.");
  }
  return zip;
}

/**
 * Lee un .xlsx de una hoja (Grafo) y lo valida con el mismo esquema que el editor y la API.
 */
export async function importExcelFile(
  file: Pick<File, "name" | "size">,
  bytes: Uint8Array,
  occupied: { nodes: number; edges: number } = { nodes: 0, edges: 0 },
): Promise<ExcelImportResult> {
  validateExcelFile(file, bytes);
  const zip = await readZip(bytes);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) throw new ExcelFileError("No se encontró el libro de Excel.");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = loadSharedStrings(sharedXml);
  const wb = parseXml(workbookXml);
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const rel of localTags(parseXml(relsXml), "Relationship")) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) rels.set(id, target.replace(/\\/g, "/"));
    }
  }
  const tables = new Map<string, ExcelTable>();
  for (const sheet of localTags(wb, "sheet")) {
    const name = sheet.getAttribute("name") ?? "";
    if (foldHeader(name) === foldHeader(EXCEL_SHEETS.lists)) continue;
    const rid =
      sheet.getAttribute("r:id") ??
      sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
      sheet.getAttribute("id") ??
      "";
    const target = rels.get(rid);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    tables.set(name, sheetToTable(xml, shared));
  }
  const preferred = [...tables.entries()].find(([name, table]) => foldHeader(name) === foldHeader(EXCEL_SHEETS.graph) && looksLikeHeader(table.headers));
  const fallback = [...tables.entries()].find(([, table]) => looksLikeHeader(table.headers));
  const chosen = preferred ?? fallback;
  if (!chosen) {
    throw new ExcelFileError("No se encontró la hoja «Grafo» con las columnas ref, tipo y nombre. Descarga la plantilla nueva.");
  }
  return graphFromExcelSheet(chosen[1], occupied);
}
