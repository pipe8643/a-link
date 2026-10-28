import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildExcelTemplate, excelTemplateFileName, importExcelFile, validateExcelFile } from "./xlsx-workbook";

describe("validateExcelFile", () => {
  it("rechaza .xls, vacío y lo que no es ZIP", () => {
    expect(() => validateExcelFile({ name: "g.xls", size: 4 }, new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(/xlsx/);
    expect(() => validateExcelFile({ name: "g.xlsx", size: 0 }, new Uint8Array())).toThrow(/vacío/);
    expect(() => validateExcelFile({ name: "g.xlsx", size: 4 }, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/xls antiguo/);
    expect(() => validateExcelFile({ name: "g.xlsx", size: 4 }, new Uint8Array([1, 2, 3, 4]))).toThrow(/válido/);
  });
});

describe("plantilla e importación", () => {
  it("la plantilla se lee y produce el grafo de ejemplo", async () => {
    const bytes = await buildExcelTemplate();
    expect(excelTemplateFileName.endsWith(".xlsx")).toBe(true);
    const file = { name: excelTemplateFileName, size: bytes.length };
    const r = await importExcelFile(file, bytes);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes).toHaveLength(3);
    expect(r.value.edges).toHaveLength(2);
    expect(r.value.nodes.some((n: { type: string; label: string }) => n.type === "person" && n.label === "Ana Pérez")).toBe(true);
  });

  it("un payload XSS en el nombre se queda como texto", async () => {
    const bytes = await buildExcelTemplate();
    const r = await importExcelFile({ name: "p.xlsx", size: bytes.length }, bytes);
    expect(r.ok).toBe(true);
  });

  it("incluye desplegables y oculta la hoja Listas", async () => {
    const bytes = await buildExcelTemplate();
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain('name="Grafo"');
    expect(workbook).toContain('name="Listas"');
    expect(workbook).toContain('state="hidden"');
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("dataValidations");
    expect(sheet).toContain("Listas!$A$1");
    expect(sheet.includes("<f>")).toBe(false);
  });

  it("acepta las listas desplegables que Excel guarda como xm:f", async () => {
    const zip = await JSZip.loadAsync(await buildExcelTemplate());
    const path = "xl/worksheets/sheet1.xml";
    const sheet = (await zip.file(path)!.async("string"))
      .replace("<worksheet ", '<worksheet xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" ')
      .replace(/<formula1>([^<]+)<\/formula1>/g, "<formula1><xm:f>$1</xm:f></formula1>");
    zip.file(path, sheet);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const r = await importExcelFile({ name: "p.xlsx", size: bytes.length }, bytes);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
  });

  it("rechaza una fórmula en una celda", async () => {
    const zip = await JSZip.loadAsync(await buildExcelTemplate());
    const path = "xl/worksheets/sheet1.xml";
    const sheet = (await zip.file(path)!.async("string")).replace("</sheetData>", `<row r="99"><c r="A99"><f>SUM(1)</f><v>1</v></c></row></sheetData>`);
    zip.file(path, sheet);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(importExcelFile({ name: "p.xlsx", size: bytes.length }, bytes)).rejects.toThrow(/fórmulas/);
  });
});
