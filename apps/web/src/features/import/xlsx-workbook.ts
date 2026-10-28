import {
  EXCEL_IMPORT_LIMITS,
  EXCEL_SHEETS,
  excelTemplateTables,
  foldHeader,
  graphFromExcelTables,
  type ExcelImportResult,
  type ExcelTable,
} from "@a-link/shared";
import JSZip from "jszip";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] as const;
const MAX_UNCOMPRESSED = 8 * 1024 * 1024;
const MAX_ENTRIES = 40;

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

function sheetXml(name: string, table: ExcelTable): string {
  const rows = [table.headers, ...table.rows];
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value: string, c: number) => {
          const ref = `${colLetter(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  void name;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function instructionsXml(lines: string[][]): string {
  return sheetXml(EXCEL_SHEETS.instructions, { headers: lines[0] ?? ["Instrucciones"], rows: lines.slice(1) });
}

/** Genera la plantilla .xlsx (solo texto; sin macros ni fórmulas). */
export async function buildExcelTemplate(): Promise<Uint8Array> {
  const spec = excelTemplateTables();
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
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
<sheets>
<sheet name="${EXCEL_SHEETS.entities}" sheetId="1" r:id="rId1"/>
<sheet name="${EXCEL_SHEETS.relations}" sheetId="2" r:id="rId2"/>
<sheet name="${EXCEL_SHEETS.instructions}" sheetId="3" r:id="rId3"/>
</sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheetXml(EXCEL_SHEETS.entities, spec.entities));
  zip.file("xl/worksheets/sheet2.xml", sheetXml(EXCEL_SHEETS.relations, spec.relations));
  zip.file("xl/worksheets/sheet3.xml", instructionsXml(spec.instructions));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const excelTemplateFileName = "plantilla-grafo-a-link.xlsx";
export const excelTemplateMime = XLSX_MIME;

function isDateHeader(header: string): boolean {
  const f = foldHeader(header);
  return ["inicio", "fin", "startdate", "enddate", "issuedon", "fecha", "fechainicio", "fechafin"].includes(f) || f.includes("fecha");
}

function numberToCell(n: number, header: string): string {
  if (isDateHeader(header) && n >= 2000 && n < 80_000) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000);
    const d = new Date(utc);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(n);
}

function loadSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  return localTags(doc, "si").map((si) => textOf(si));
}

function sheetToTable(xml: string, shared: string[]): ExcelTable {
  const doc = parseXml(xml);
  if (localTags(doc, "f").length > 0) throw new ExcelFileError("El Excel no puede contener fórmulas. Copia los valores y vuelve a guardarlo.");
  const rowsEl = localTags(doc, "row");
  let width = 0;
  const sparse: Array<Map<number, string>> = [];
  for (const row of rowsEl) {
    const cells = new Map<number, string>();
    for (const c of localTags(row, "c")) {
      const ref = c.getAttribute("r") ?? "";
      const i = colIndex(ref);
      if (i < 0) continue;
      width = Math.max(width, i + 1);
      const t = c.getAttribute("t");
      let value = "";
      if (t === "inlineStr") value = textOf(localTags(c, "t")[0]);
      else if (t === "s") {
        const idx = Number(textOf(localTags(c, "v")[0]));
        value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
      } else if (t === "str" || t === "b") value = textOf(localTags(c, "v")[0]);
      else if (t === "e") throw new ExcelFileError("El Excel contiene celdas con error.");
      else {
        const raw = textOf(localTags(c, "v")[0]);
        if (raw === "") value = "";
        else if (t === "d") value = raw.slice(0, 10);
        else {
          const n = Number(raw);
          value = Number.isFinite(n) ? raw : raw;
        }
      }
      cells.set(i, value);
    }
    sparse.push(cells);
  }
  if (sparse.length === 0) return { headers: [], rows: [] };
  const headerMap = sparse[0]!;
  const headers: string[] = [];
  for (let i = 0; i < width; i++) headers.push((headerMap.get(i) ?? "").trim());
  while (headers.length > 0 && headers.at(-1) === "") headers.pop();
  const rows: string[][] = [];
  for (const cells of sparse.slice(1)) {
    const row = headers.map((header, i) => {
      const raw = cells.get(i) ?? "";
      const n = Number(raw);
      if (raw !== "" && Number.isFinite(n) && !/^0\d/.test(raw) && isDateHeader(header)) return numberToCell(n, header);
      return raw;
    });
    if (row.every((c) => c === "")) continue;
    rows.push(row);
  }
  return { headers, rows };
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

function findSheet(tables: Map<string, ExcelTable>, ...names: string[]): ExcelTable | undefined {
  const wanted = new Set(names.map(foldHeader));
  for (const [name, table] of tables) {
    if (wanted.has(foldHeader(name))) return table;
  }
  return undefined;
}

/**
 * Lee un .xlsx y lo valida con el mismo esquema que el editor y la API.
 * `occupied` cuenta lo que ya hay en el grafo (para no pasar el límite al añadir).
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
  const entities = findSheet(tables, EXCEL_SHEETS.entities, "Entities");
  if (!entities) throw new ExcelFileError(`Falta la hoja «${EXCEL_SHEETS.entities}». Descarga la plantilla para ver la estructura.`);
  const relations = findSheet(tables, EXCEL_SHEETS.relations, "Relations", "Relaciones") ?? { headers: [], rows: [] };
  return graphFromExcelTables(entities, relations, occupied);
}
