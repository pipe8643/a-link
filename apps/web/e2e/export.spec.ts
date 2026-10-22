import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Exportación (PNG, JPEG, PDF, PowerPoint). La primera parte NO necesita licencia de ZoomCharts: PowerPoint editable
 * se construye con las posiciones guardadas. La segunda parte renderiza con ZoomCharts real y se omite de forma
 * explícita si no hay licencia en .env.
 */
const ORIGIN = "http://127.0.0.1:5273";
const SECRET = "Nombre-Secreto-Zeta";
const SECRET_GRAPH = "Grafo secreto confidencial";

const TYPES = ["person", "property", "vehicle", "phone", "social", "organization", "bank_account", "document", "location", "other"];
const EVIDENCE = ["recorded", "hypothesis", "observation"];
const DIRECTIONS = ["forward", "both", "none"];

/** Grafo sintético con posiciones muy dispersas (el export debe encuadrar TODO, no solo lo visible). */
function syntheticGraph(count = 24, withPositions = true) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    type: TYPES[i % TYPES.length]!,
    label: i === 0 ? SECRET : i === 1 ? "Ñandú <Ø> & «comillas»" : `Entidad ${i}`,
    description: "",
    notes: "",
    tags: [],
    metadata: {},
    // Una elipse muy ancha: 3200 × 1400 unidades.
    positionX: withPositions ? Math.round(1600 * Math.cos((i / count) * 2 * Math.PI)) : null,
    positionY: withPositions ? Math.round(700 * Math.sin((i / count) * 2 * Math.PI)) : null,
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: crypto.randomUUID(),
    sourceId: nodes[i]!.id,
    targetId: n.id,
    relationshipType: "contact",
    label: "",
    metadata: { direction: DIRECTIONS[i % 3]!, evidenceClass: EVIDENCE[i % 3]! },
  }));
  return { nodes, edges };
}

async function seed(page: Page, tag: string, name = "Grafo de exportación", count = 24, withPositions = true) {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, name);
  const g = syntheticGraph(count, withPositions);
  const put = await api(page.request, "PUT", `/graphs/${id}/content`, { expectedRevision: 1, ...g });
  expect(put.status(), await put.text()).toBe(200);
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return { id, ...g };
}

const openDialog = async (page: Page) => {
  await page.getByRole("button", { name: /^Exportar/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
  await expect(dialog).toBeVisible();
  return dialog;
};

async function exportAs(page: Page, format: string, options: Record<string, string> = {}): Promise<{ bytes: Buffer; download: Download }> {
  const dialog = await openDialog(page);
  await dialog.getByLabel("Formato").selectOption(format);
  for (const [label, value] of Object.entries(options)) await dialog.getByLabel(label, { exact: true }).selectOption(value);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
  const path = await download.path();
  await expect(dialog).toBeHidden();
  return { bytes: readFileSync(path), download };
}

const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b;
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

test.describe("exportación: sin licencia de ZoomCharts", () => {
  test("el botón se desactiva con el grafo vacío", async ({ page }) => {
    await registerViaApi(page, "ex0");
    const id = await createGraphViaApi(page, "Vacío");
    await page.goto(`/graphs/${id}/editor`);
    await expect(page.getByRole("button", { name: /^Exportar/ }).first()).toBeDisabled();
  });

  test("las opciones cambian según el formato y «transparente» solo existe en PNG", async ({ page }) => {
    await seed(page, "ex1");
    const dialog = await openDialog(page);
    const background = dialog.getByLabel("Fondo", { exact: true });
    await expect(background.locator("option")).toHaveCount(3);
    await dialog.getByLabel("Formato").selectOption("jpeg");
    await expect(background.locator("option")).toHaveCount(2);
    await expect(dialog.getByLabel("Proporción")).toBeVisible();
    await dialog.getByLabel("Formato").selectOption("pdf");
    await expect(dialog.getByLabel("Tamaño de página")).toBeVisible();
    await expect(dialog.getByLabel("Leyenda", { exact: false })).toBeVisible();
    await expect(dialog.getByLabel("Proporción")).toHaveCount(0);
    await dialog.getByLabel("Formato").selectOption("pptx-editable");
    await expect(dialog.getByLabel("Resolución")).toHaveCount(0);
    await expect(dialog.getByText(/no quedan «pegadas»/)).toBeVisible();
  });

  test("PowerPoint editable se descarga con nombre seguro y con una forma por entidad (sin lienzo ni licencia)", async ({ page }) => {
    // Sin servicio de licencias: el lienzo no arranca y se usan las posiciones guardadas.
    await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
    const { nodes } = await seed(page, "ex2", "Caso: <uno>/2026");
    const dialog = await openDialog(page);
    await expect(dialog.getByLabel("Nombre del archivo")).toHaveValue("Caso uno 2026");
    await dialog.getByLabel("Formato").selectOption("pptx-editable");
    await dialog.getByLabel("Nombre del archivo").fill("../../informe:final");
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
    expect(download.suggestedFilename()).toBe("informe final.pptx");
    const bytes = readFileSync(await download.path());
    expect(isZip(bytes)).toBe(true);
    // Número de formas de entidad ≈ nodos: cada etiqueta aparece en el XML de la diapositiva.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    for (const n of nodes.slice(2)) expect(xml).toContain(n.label);
    expect(xml).toContain(SECRET);
    await expect(page.getByText(/Se descargó/)).toBeVisible();
  });
});

// ------------------------------------------------------------------------------------------------
const HAS_LICENSE = !!process.env.ZOOMCHARTS_LICENSE && !!process.env.ZOOMCHARTS_LICENSE_KEY;

/** Analiza una imagen dentro del navegador (así no hace falta ninguna librería de imágenes en Node). */
async function analyze(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(
    async ({ b64, mime }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const px = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const;
      };
      const bg = px(2, 2);
      let minX = width, minY = height, maxX = -1, maxY = -1, opaque = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // La licencia de desarrollo dibuja su logotipo en la esquina inferior derecha: no es parte del grafo.
          if (x > width * 0.8 && y > height * 0.85) continue;
          const p = px(x, y);
          if (p[3] > 200) opaque++;
          const diff = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) + Math.abs(p[3] - bg[3]);
          if (diff > 60) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { width, height, bg, ink: { minX, minY, maxX, maxY }, opaque };
    },
    { b64: bytes.toString("base64"), mime },
  );
}

test.describe("exportación: con ZoomCharts real", () => {
  test.skip(!HAS_LICENSE, "Define ZOOMCHARTS_LICENSE y ZOOMCHARTS_LICENSE_KEY en .env para ejecutar estas pruebas.");
  test.setTimeout(180_000);

  test("PNG: tamaño exacto, TODO el grafo dentro de la imagen y aprovechando el espacio", async ({ page }, testInfo) => {
    await seed(page, "ez1");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    const { bytes } = await exportAs(page, "png", { Proporción: "16:9", Resolución: "2" });
    await testInfo.attach("export-png", { body: bytes, contentType: "image/png" });
    expect(isPng(bytes)).toBe(true);
    const r = await analyze(page, bytes, "image/png");
    expect([r.width, r.height]).toEqual([2400, 1350]);
    expect(r.bg.slice(0, 3)).toEqual([255, 255, 255]);
    // Nada recortado: queda margen en los cuatro lados de lo dibujado…
    expect(r.ink.minX).toBeGreaterThan(4);
    expect(r.ink.minY).toBeGreaterThan(4);
    expect(r.ink.maxX).toBeLessThan(r.width - 5);
    expect(r.ink.maxY).toBeLessThan(r.height - 5);
    // …y el grafo aprovecha el espacio: no sale diminuto en medio de la imagen.
    const fillX = (r.ink.maxX - r.ink.minX) / r.width;
    const fillY = (r.ink.maxY - r.ink.minY) / r.height;
    expect(Math.max(fillX, fillY)).toBeGreaterThan(0.6);
    // Y el grafo es una elipse: hay tinta en las cuatro zonas (arriba/abajo/izquierda/derecha).
    expect(r.ink.minX).toBeLessThan(r.width * 0.2);
    expect(r.ink.maxX).toBeGreaterThan(r.width * 0.8);
  });

  test("PNG transparente y fondo oscuro", async ({ page }) => {
    await seed(page, "ez2");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    const t = await exportAs(page, "png", { Fondo: "transparent", Resolución: "1" });
    const rt = await analyze(page, t.bytes, "image/png");
    expect(rt.bg[3]).toBe(0); // esquina transparente
    expect(rt.opaque).toBeGreaterThan(500); // y hay entidades opacas

    const d = await exportAs(page, "png", { Fondo: "dark", Resolución: "1" });
    const rd = await analyze(page, d.bytes, "image/png");
    expect(rd.bg[3]).toBe(255);
    expect(rd.bg[0] + rd.bg[1] + rd.bg[2]).toBeLessThan(200);
  });

  test("JPEG, PDF y PowerPoint con imagen son ficheros válidos", async ({ page }) => {
    await seed(page, "ez3");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");

    const jpg = await exportAs(page, "jpeg", { Resolución: "1" });
    expect(isJpeg(jpg.bytes)).toBe(true);
    expect(jpg.download.suggestedFilename()).toMatch(/\.jpg$/);
    const rj = await analyze(page, jpg.bytes, "image/jpeg");
    expect(rj.bg[0]).toBeGreaterThan(240);

    const pdf = await exportAs(page, "pdf", { Resolución: "1" });
    expect(isPdf(pdf.bytes)).toBe(true);
    // pdf-lib guarda los objetos comprimidos: se cuenta con el propio lector en vez de buscar texto.
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(pdf.bytes);
    expect(parsed.getPageCount()).toBe(1);
    const { width, height } = parsed.getPage(0).getSize();
    expect(width).toBeGreaterThan(height); // la elipse del grafo es apaisada → página horizontal automática

    const ppt = await exportAs(page, "pptx-image", { Resolución: "1" });
    expect(isZip(ppt.bytes)).toBe(true);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(ppt.bytes);
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
  });

  test("un grafo sin posiciones guardadas (distribución automática) se exporta completo y encuadrado", async ({ page }) => {
    const { nodes } = await seed(page, "ez4", "Sin posiciones", 12, false);
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    await page.waitForTimeout(2500); // deja que termine la distribución automática del lienzo en pantalla
    const png = await exportAs(page, "png", { Proporción: "4:3", Resolución: "1" });
    const r = await analyze(page, png.bytes, "image/png");
    expect([r.width, r.height]).toEqual([1200, 900]);
    expect(r.ink.minX).toBeGreaterThan(2);
    expect(r.ink.minY).toBeGreaterThan(2);
    expect(r.ink.maxX).toBeLessThan(r.width - 3);
    expect(r.ink.maxY).toBeLessThan(r.height - 3);
    expect(Math.max((r.ink.maxX - r.ink.minX) / r.width, (r.ink.maxY - r.ink.minY) / r.height)).toBeGreaterThan(0.4);

    // PowerPoint editable usa las posiciones del lienzo: todas las entidades aparecen como formas.
    const ppt = await exportAs(page, "pptx-editable");
    const JSZip = (await import("jszip")).default;
    const xml = await (await JSZip.loadAsync(ppt.bytes)).file("ppt/slides/slide1.xml")!.async("string");
    for (const n of nodes.slice(2)) expect(xml).toContain(n.label);
  });

  test("privacidad: ningún formato envía datos del grafo ni contacta con el proxy de exportación de ZoomCharts", async ({ page }) => {
    const external: Array<{ method: string; url: string; body: string | null }> = [];
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== ORIGIN) external.push({ method: r.method(), url: r.url(), body: r.postData() });
    });
    await seed(page, "ez5", SECRET_GRAPH);
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    for (const format of ["png", "jpeg", "pdf", "pptx-image", "pptx-editable"]) await exportAs(page, format, format === "pptx-editable" ? {} : { Resolución: "1" });

    const hosts = new Set(external.map((r) => new URL(r.url).host));
    expect([...hosts].filter((h) => h !== "api.zoomcharts-cloud.com")).toEqual([]);
    expect(external.some((r) => r.url.includes("echo.zoomcharts-cloud.com"))).toBe(false);
    for (const r of external) {
      const all = `${r.url}\n${r.body ?? ""}`;
      expect(all).not.toContain(SECRET);
      expect(all).not.toContain("Secreto");
      expect(all).not.toContain("Ñandú");
    }
    // El lienzo auxiliar de exportación no queda en la página.
    await expect(page.locator("[data-export-host]")).toHaveCount(0);
  });
});
