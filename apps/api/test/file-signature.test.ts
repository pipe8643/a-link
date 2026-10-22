import { describe, expect, it } from "vitest";
import { detectFormat, normalizeMime, zipEntryNames } from "../src/exports/file-signature.js";
import { cleanExportName } from "../src/exports/exports.service.js";
import { makeJpeg, makePdf, makePng, makePptx, makeZip } from "./helpers/files.js";

describe("detectFormat (por contenido, no por lo que declare el cliente)", () => {
  it("reconoce PNG, JPEG, PDF y PowerPoint", () => {
    expect(detectFormat(makePng())).toBe("PNG");
    expect(detectFormat(makeJpeg())).toBe("JPEG");
    expect(detectFormat(makePdf())).toBe("PDF");
    expect(detectFormat(makePptx())).toBe("PPTX");
  });

  it("rechaza contenido que no es ninguno de ellos aunque lo parezca por fuera", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
    const pngLike = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("no-es-un-png-completo-pero-largo")]);
    const pdfLate = Buffer.concat([Buffer.from("<html></html>\n"), makePdf()]); // la firma PDF debe estar al principio
    const zipWithoutPresentation = makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w/>" });
    const plainZip = makeZip({ "hola.txt": "hola" });
    for (const [name, data] of Object.entries({ html, exe, pngLike, pdfLate, zipWithoutPresentation, plainZip, vacio: Buffer.alloc(0), corto: Buffer.from([0xff]) })) {
      expect(detectFormat(data), name).toBeNull();
    }
  });

  it("un PNG truncado antes de IHDR o un ZIP con el directorio dañado no se aceptan", () => {
    expect(detectFormat(makePng().subarray(0, 14))).toBeNull();
    const pptx = makePptx();
    const broken = Buffer.from(pptx);
    broken.writeUInt32LE(0xdeadbeef, broken.length - 22 + 16); // desplazamiento del directorio central incorrecto
    expect(detectFormat(broken)).toBeNull();
    expect(detectFormat(pptx.subarray(0, pptx.length - 10))).toBeNull(); // sin fin de directorio
  });

  it("lee los nombres del directorio central sin descomprimir", () => {
    expect(zipEntryNames(makeZip({ "a.txt": "1", "b/c.xml": "2" }))).toEqual(["a.txt", "b/c.xml"]);
    expect(zipEntryNames(Buffer.from("no es un zip"))).toBeNull();
  });
});

describe("normalizeMime", () => {
  it("ignora parámetros y mayúsculas", () => {
    expect(normalizeMime("Image/PNG; charset=binary")).toBe("image/png");
    expect(normalizeMime(undefined)).toBe("");
  });
});

describe("cleanExportName", () => {
  it("quita separadores de ruta, caracteres de control y la extensión repetida", () => {
    expect(cleanExportName("../../etc/passwd", "PNG", "g")).toBe(".. etc passwd");
    expect(cleanExportName("Informe final.PNG", "PNG", "g")).toBe("Informe final");
    expect(cleanExportName("a\u0000b\nc\\d", "PDF", "g")).toBe("a b c d");
    expect(cleanExportName("caso:uno|dos?", "PDF", "g")).toBe("caso uno dos");
  });

  it("nunca devuelve un nombre vacío y acota la longitud", () => {
    expect(cleanExportName("   ", "PNG", "Mi grafo")).toBe("Mi grafo");
    expect(cleanExportName("///", "PNG", "")).toBe("exportacion");
    expect(cleanExportName("x".repeat(500), "PNG", "g")).toHaveLength(120);
    expect(cleanExportName("....oculto", "PNG", "g")).toBe("oculto");
  });
});
