import { randomUUID } from "node:crypto";
import { ENTITY_TYPE_IDS, edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { defaultExportOptions } from "./export-options";
import { resolvePositions } from "./layout";
import { buildLegend } from "./legend";
import { planPdf, sanitizeForFont } from "./pdf";
import { ExportTooLargeError, PPTX_EDITABLE_LIMITS, assertEditableSize, buildPptxEditable, buildPptxImage, buildPptxLive, pptxContentBox, pptxImageAspect } from "./pptx";
import { EmptyGraphError, runExport } from "./run-export";

const node = (label: string, type = "person", extra: Record<string, unknown> = {}): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label, ...extra });
const edge = (a: GraphNodeData, b: GraphNodeData, evidenceClass = "recorded", direction = "forward"): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact", metadata: { direction, evidenceClass } });

// PNG de 1×1 válido (se usa como «imagen del grafo» en las pruebas de montaje).
const PNG_1X1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));

const sample = (): GraphSnapshot => {
  const ids = ENTITY_TYPE_IDS.slice(0, 4);
  const nodes = ids.map((t, i) => node(`Entidad ${i + 1} á é ñ`, t));
  const edges = [edge(nodes[0]!, nodes[1]!, "recorded", "forward"), edge(nodes[1]!, nodes[2]!, "hypothesis", "both"), edge(nodes[2]!, nodes[3]!, "observation", "none"), edge(nodes[0]!, nodes[1]!, "recorded", "forward")];
  return { nodes, edges };
};

const common = (doc: GraphSnapshot, over: Partial<Parameters<typeof buildPptxImage>[0]> = {}) => ({
  title: "Informe «prueba»",
  date: new Date("2026-03-04T12:00:00Z"),
  includeTitle: true,
  includeDate: true,
  includeLegend: true,
  edgeLabels: true,
  legend: buildLegend(doc),
  ...over,
});

describe("PDF", () => {
  const input = (doc: GraphSnapshot, over = {}) => ({ pageSize: "a4" as const, orientation: "auto" as const, contentAspect: 1.5, ...common(doc), ...over });

  it("sanitizeForFont sustituye lo no representable y quita controles", () => {
    const supported = new Set([..."Hola ñ".split("").map((c) => c.codePointAt(0)!)]);
    expect(sanitizeForFont("Hola ñ", supported)).toBe("Hola ñ");
    expect(sanitizeForFont("Hola 😀 世", supported)).toBe("Hola ? ?");
    expect(sanitizeForFont("Ho\u0000la\n\tñ", supported)).toBe("Ho la ñ");
  });

  it("orientación: automática según el grafo y forzada", async () => {
    const doc = sample();
    const wide = await planPdf(input(doc, { contentAspect: 2 }));
    expect(wide.pageWidth).toBeGreaterThan(wide.pageHeight);
    const tall = await planPdf(input(doc, { contentAspect: 0.5 }));
    expect(tall.pageWidth).toBeLessThan(tall.pageHeight);
    const forced = await planPdf(input(doc, { contentAspect: 2, orientation: "portrait" }));
    expect(forced.pageWidth).toBeLessThan(forced.pageHeight);
  });

  it("la leyenda y el encabezado reducen el hueco de la imagen", async () => {
    const doc = sample();
    const full = await planPdf(input(doc));
    const bare = await planPdf(input(doc, { includeTitle: false, includeDate: false, includeLegend: false }));
    // Sin encabezado ni leyenda el hueco es más alto (más cuadrado) para el mismo ancho.
    expect(bare.imageAspect).toBeLessThan(full.imageAspect);
  });

  it("genera un PDF válido de una página con los metadatos esperados y sin autor", async () => {
    const doc = sample();
    const plan = await planPdf(input(doc, { title: "Título 😀 con ñ" }));
    const bytes = await plan.finish({ bytes: PNG_1X1, kind: "png" });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    // `updateMetadata:false`: si no, pdf-lib sobrescribe el productor al abrir el documento.
    const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect(page.getWidth()).toBeCloseTo(plan.pageWidth, 1);
    expect(parsed.getProducer()).toBe("A-Link");
    expect(parsed.getAuthor() ?? "").toBe("");
    expect(parsed.getTitle()).not.toContain("😀");
  });

  it("admite un título larguísimo y una leyenda muy poblada sin fallar", async () => {
    const nodes = ENTITY_TYPE_IDS.map((t, i) => node(`n${i}`, t));
    const doc: GraphSnapshot = { nodes, edges: [edge(nodes[0]!, nodes[1]!, "recorded"), edge(nodes[1]!, nodes[2]!, "hypothesis"), edge(nodes[2]!, nodes[3]!, "observation")] };
    const plan = await planPdf(input(doc, { title: "x".repeat(2000), pageSize: "letter" }));
    const bytes = await plan.finish({ bytes: PNG_1X1, kind: "png" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("PowerPoint", () => {
  const slideXml = async (bytes: Uint8Array, n = 1) => {
    const zip = await JSZip.loadAsync(bytes);
    return { zip, xml: await zip.file(`ppt/slides/slide${n}.xml`)!.async("string") };
  };

  it("el hueco del contenido depende de lo que se incluya", () => {
    const all = pptxContentBox({ includeTitle: true, includeDate: true, includeLegend: true });
    const none = pptxContentBox({ includeTitle: false, includeDate: false, includeLegend: false });
    expect(none.h).toBeGreaterThan(all.h);
    // Más alto disponible ⇒ proporción ancho/alto menor.
    expect(pptxImageAspect({ includeTitle: false, includeDate: false, includeLegend: false })).toBeLessThan(pptxImageAspect({ includeTitle: true, includeDate: true, includeLegend: true }));
  });

  it("PowerPoint interactivo: vista previa, hipervínculo e instrucciones; el hueco se reduce por la barra", async () => {
    const token = "E".repeat(43);
    const url = `https://app.example/s#${token}`;
    expect(pptxContentBox({ includeTitle: true, includeDate: true, includeLegend: true, liveBar: true }).h).toBeLessThan(pptxContentBox({ includeTitle: true, includeDate: true, includeLegend: true }).h);
    const bytes = await buildPptxLive(common(sample()), { bytes: PNG_1X1, mime: "image/png", width: 1200, height: 700 }, { url, expiresAt: new Date("2026-04-01T12:00:00Z") });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    expect(await zip.file("ppt/slides/slide2.xml")!.async("string")).toContain("Web Viewer");
    const all = (await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string")) + (await zip.file("ppt/slides/slide2.xml")!.async("string"));
    expect(all).toContain(token);
    expect(await zip.file("docProps/core.xml")!.async("string")).not.toContain(token);
  });

  it("PowerPoint con imagen: un .pptx válido (ZIP OOXML) con la imagen incrustada", async () => {
    const doc = sample();
    const bytes = await buildPptxImage(common(doc), { bytes: PNG_1X1, mime: "image/png", width: 1200, height: 700 });
    expect(bytes[0]).toBe(0x50); // «PK»
    expect(bytes[1]).toBe(0x4b);
    const { zip, xml } = await slideXml(bytes);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    expect(xml).toContain("<p:pic>");
    expect(xml).toContain("Informe «prueba»");
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("A-Link");
  });

  it("PowerPoint editable: una forma por entidad y una línea por relación, con etiquetas", async () => {
    const doc = sample();
    const positions = resolvePositions(doc);
    const bytes = await buildPptxEditable(common(doc), doc, positions);
    const { xml } = await slideXml(bytes);
    for (const n of doc.nodes) expect(xml).toContain(n.label);
    expect(xml).not.toContain("<p:pic>");
    // Líneas de relación: `<a:prstGeom prst="line">` (más las muestras de la leyenda).
    const lines = (xml.match(/prst="line"/g) ?? []).length;
    expect(lines).toBeGreaterThanOrEqual(doc.edges.length);
    // Naturaleza de la evidencia: hay trazos discontinuos.
    expect(xml).toMatch(/prstDash val="(dash|sysDot)"/);
  });

  it("PowerPoint editable sin título, fecha ni leyenda no los dibuja", async () => {
    const doc = sample();
    const bytes = await buildPptxEditable(common(doc, { includeTitle: false, includeDate: false, includeLegend: false }), doc, resolvePositions(doc));
    const { xml } = await slideXml(bytes);
    expect(xml).not.toContain("Informe «prueba»");
    expect(xml).not.toContain("Generado");
  });

  it("relaciones opuestas entre el mismo par (A→B y B→A) se dibujan separadas, no una sobre otra", async () => {
    const a = node("Ana", "person", { positionX: 0, positionY: 0 });
    const b = node("Beto", "person", { positionX: 600, positionY: 0 });
    const doc: GraphSnapshot = { nodes: [a, b], edges: [edge(a, b, "recorded"), edge(b, a, "hypothesis")] };
    const { xml } = await slideXml(await buildPptxEditable(common(doc, { includeLegend: false }), doc, resolvePositions(doc)));
    // Se separa el XML por formas y se toma la posición vertical de las que son líneas.
    const ys = xml
      .split("<p:sp>")
      .filter((block) => block.includes('prst="line"'))
      .map((block) => Number(/<a:off x="-?\d+" y="(-?\d+)"/.exec(block)![1]));
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(100_000); // > 0,1 pulgada (914 400 EMU = 1 in)
  });

  it("rotula las relaciones con su etiqueta o, si no tiene, con el nombre de su tipo; se puede desactivar", async () => {
    const a = node("Ana", "person", { positionX: 0, positionY: 0 });
    const b = node("Beto", "person", { positionX: 600, positionY: 0 });
    const c = node("Carla", "person", { positionX: 300, positionY: 400 });
    const custom = { ...edge(a, c), label: "Hermanos" };
    const doc: GraphSnapshot = { nodes: [a, b, c], edges: [edge(a, b), custom] };
    const on = (await slideXml(await buildPptxEditable(common(doc), doc, resolvePositions(doc)))).xml;
    expect(on).toContain("Contacto");
    expect(on).toContain("Hermanos");
    const off = (await slideXml(await buildPptxEditable(common(doc, { edgeLabels: false }), doc, resolvePositions(doc)))).xml;
    expect(off).not.toContain("Contacto");
    expect(off).not.toContain("Hermanos");
  });

  it("escapa XML en etiquetas con caracteres especiales", async () => {
    const a = node(`<b>&"'</b> ñ`);
    const doc: GraphSnapshot = { nodes: [a], edges: [] };
    const bytes = await buildPptxEditable(common(doc), doc, resolvePositions(doc));
    const { xml } = await slideXml(bytes);
    expect(xml).not.toContain("<b>");
    expect(xml).toContain("&lt;b&gt;");
  });

  it("rechaza grafos demasiado grandes para el modo editable", () => {
    const many = Array.from({ length: PPTX_EDITABLE_LIMITS.maxNodes + 1 }, (_, i) => node(`n${i}`));
    expect(() => assertEditableSize({ nodes: many, edges: [] })).toThrow(ExportTooLargeError);
    expect(() => assertEditableSize({ nodes: many.slice(0, 2), edges: [] })).not.toThrow();
  });
});

describe("runExport", () => {
  it("un grafo vacío no se exporta", async () => {
    await expect(runExport({ doc: { nodes: [], edges: [] }, graphName: "x", options: defaultExportOptions("x", false) })).rejects.toBeInstanceOf(EmptyGraphError);
  });

  it("rechaza opciones inválidas antes de hacer nada", async () => {
    await expect(runExport({ doc: sample(), graphName: "x", options: { ...defaultExportOptions("x", false), resolution: 9 as never } })).rejects.toThrow();
  });

  it("PowerPoint editable funciona sin lienzo ni licencia (disposición de reserva) y nombra el archivo con seguridad", async () => {
    const doc = sample();
    const res = await runExport({
      doc,
      graphName: "Caso: <secreto>/2026",
      options: { ...defaultExportOptions("x", false), format: "pptx-editable", fileName: "../../informe:final" },
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(res.fileName).toBe("informe final.pptx");
    expect(res.mime).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(res.bytes.length).toBeGreaterThan(1000);
  });

  it("el nombre cae al del grafo si el campo queda vacío", async () => {
    const res = await runExport({ doc: sample(), graphName: "Mi grafo", options: { ...defaultExportOptions("x", false), format: "pptx-editable", fileName: "" } });
    expect(res.fileName).toBe("Mi grafo.pptx");
  });

  it("PowerPoint interactivo exige el enlace (la generación del PPTX con URL se cubre en buildPptxLive; aquí no se pinta el lienzo)", async () => {
    await expect(runExport({ doc: sample(), graphName: "G", options: { ...defaultExportOptions("G", false), format: "pptx-live" } })).rejects.toThrow(/enlace de solo lectura/);
  });
});

describe("Nota de vista filtrada (PDF y PowerPoint)", () => {
  const slideXml = async (bytes: Uint8Array) => (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
  const NOTE = "Vista filtrada: 3 de 10 entidades";
  const bare = { includeTitle: false, includeDate: false, includeLegend: false };

  it("PDF: la nota reserva su sitio en la cabecera aunque no haya título ni fecha, y no rompe con caracteres no admitidos", async () => {
    const doc = sample();
    const input = (over = {}) => ({ pageSize: "a4" as const, orientation: "landscape" as const, contentAspect: 1.5, ...common(doc), ...bare, ...over });
    const without = await planPdf(input());
    const withNote = await planPdf(input({ note: NOTE }));
    expect(withNote.imageAspect).toBeGreaterThan(without.imageAspect); // menos alto ⇒ más apaisado
    const emoji = await planPdf(input({ note: `${NOTE} 😀`, includeTitle: true, includeDate: true }));
    const bytes = await emoji.finish({ bytes: PNG_1X1, kind: "png" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    // Una nota larguísima se recorta en lugar de desbordar la página.
    const long = await planPdf(input({ note: "x".repeat(3000), includeTitle: true }));
    expect((await PDFDocument.load(await long.finish({ bytes: PNG_1X1, kind: "png" }))).getPageCount()).toBe(1);
  });

  it("PowerPoint: el hueco cambia con la nota y el texto aparece en la diapositiva (con o sin título y fecha)", async () => {
    const doc = sample();
    expect(pptxContentBox({ ...bare, note: NOTE }).h).toBeLessThan(pptxContentBox(bare).h);
    expect(pptxImageAspect({ ...bare, note: NOTE })).toBeGreaterThan(pptxImageAspect(bare));
    const image = await buildPptxImage(common(doc, { ...bare, note: NOTE }), { bytes: PNG_1X1, mime: "image/png", width: 1200, height: 700 });
    expect(await slideXml(image)).toContain(NOTE);
    const editable = await buildPptxEditable(common(doc, { note: NOTE }), doc, resolvePositions(doc));
    const xml = await slideXml(editable);
    expect(xml).toContain(NOTE);
    expect(xml).toContain("4 de marzo de 2026"); // la fecha sigue acompañando a la nota
    expect(await slideXml(await buildPptxEditable(common(doc), doc, resolvePositions(doc)))).not.toContain("Vista filtrada");
  });

  it("runExport pasa la nota al documento", async () => {
    const doc = sample();
    const res = await runExport({ doc, graphName: "G", options: { ...defaultExportOptions("G", false), format: "pptx-editable" }, viewNote: NOTE, now: new Date("2026-03-04T12:00:00Z") });
    expect(await slideXml(res.bytes)).toContain(NOTE);
  });
});