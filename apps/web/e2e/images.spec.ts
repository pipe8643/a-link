import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Imágenes de las entidades: elegir archivo → detección de rostro (MediaPipe local) → recorte a la forma → subida →
 * pintado en el lienzo de ZoomCharts → persistencia. Las fotos son SINTÉTICAS (rostros dibujados en un lienzo): ninguna
 * persona real. Necesita la licencia de ZoomCharts para las comprobaciones del lienzo.
 */
const HAS_LICENSE = !!process.env.ZOOMCHARTS_LICENSE && !!process.env.ZOOMCHARTS_LICENSE_KEY;

/** Foto sintética de `width × height` con un rostro dibujado centrado en `(fx, fy)` y de ancho `face`. Devuelve PNG. */
async function syntheticPhoto(page: Page, o: { width: number; height: number; fx?: number; fy?: number; face?: number; mime?: "image/png" | "image/jpeg" }) {
  const base64 = await page.evaluate((p) => {
    const c = document.createElement("canvas");
    c.width = p.width;
    c.height = p.height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(0, 0, p.width, p.height);
    if (p.fx !== undefined && p.fy !== undefined && p.face) {
      const k = p.face / 280; // el dibujo de referencia mide 280 px de ancho
      ctx.save();
      ctx.translate(p.fx - 320 * k, p.fy - 330 * k);
      ctx.scale(k, k);
      ctx.fillStyle = "#3b2f2f";
      ctx.beginPath(); ctx.ellipse(320, 280, 170, 190, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f1c27d";
      ctx.beginPath(); ctx.ellipse(320, 310, 140, 175, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(265, 280, 28, 16, 0, 0, Math.PI * 2); ctx.ellipse(375, 280, 28, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath(); ctx.arc(265, 280, 11, 0, Math.PI * 2); ctx.arc(375, 280, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#3a2a1a"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(235, 250); ctx.lineTo(295, 248); ctx.moveTo(345, 248); ctx.lineTo(405, 250); ctx.stroke();
      ctx.strokeStyle = "#b5835a"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(320, 290); ctx.lineTo(310, 345); ctx.lineTo(332, 348); ctx.stroke();
      ctx.strokeStyle = "#9b4a3a"; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(320, 390, 45, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.restore();
    }
    return c.toDataURL(p.mime ?? "image/png", 0.92).split(",")[1]!;
  }, o);
  return Buffer.from(base64, "base64");
}

async function openEditorWithPerson(page: Page, tag: string) {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, "Grafo con imágenes");
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name: "Grafo con imágenes", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Persona.*añadir/ }).click();
  await expect(page.getByRole("heading", { name: "Persona", level: 2 })).toBeVisible();
  return id;
}

const pick = (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => page.getByTestId("entity-image-input").setInputFiles(file);

/** Colores (RGB) de varios puntos alrededor del centro de cada canvas del gráfico. Sirve para saber qué se pintó en el nodo. */
async function centerColors(page: Page) {
  return page.getByTestId("net-chart").evaluate((root) => {
    const out: Array<[number, number, number]> = [];
    for (const c of Array.from(root.querySelectorAll("canvas"))) {
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      for (const [dx, dy] of [[-18, -14], [18, -14], [-18, 14], [18, 14], [0, 24]] as const) {
        const d = ctx.getImageData(Math.round(c.width / 2 + dx), Math.round(c.height / 2 + dy), 1, 1).data;
        if (d[3]! > 200) out.push([d[0]!, d[1]!, d[2]!]);
      }
    }
    return out;
  });
}
const isBlue = ([r, , b]: [number, number, number]) => b > r + 80;

test.describe("imágenes de las entidades", () => {
  test("elegir foto, detectar el rostro, recortar a la forma, subir y mostrarla en el nodo; persiste y se puede quitar", async ({ page }) => {
    test.skip(!HAS_LICENSE, "Define ZOOMCHARTS_LICENSE y ZOOMCHARTS_LICENSE_KEY en .env.");
    test.setTimeout(120_000);
    const graphId = await openEditorWithPerson(page, "img1");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");

    // Sin imagen, el nodo es el círculo azul de «Persona» con su icono.
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Ajustar a la vista" }).click();
    await page.waitForTimeout(1500);
    const before = await centerColors(page);
    expect(before.length).toBeGreaterThan(0);
    expect(before.some(isBlue)).toBe(true);

    // Foto apaisada con el rostro DESCENTRADO (arriba a la izquierda): la app debe encontrarlo y centrarlo.
    const photo = await syntheticPhoto(page, { width: 900, height: 600, fx: 230, fy: 210, face: 200 });
    await pick(page, { name: "foto-sintetica.png", mimeType: "image/png", buffer: photo });
    const dialog = page.getByRole("dialog", { name: /Recortar imagen de persona/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("crop-message")).toHaveText(/Rostro detectado y centrado/, { timeout: 30_000 });

    const uploaded = page.waitForResponse((r) => r.url().includes(`/graphs/${graphId}/images`) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "Usar imagen" }).click();
    const res = await uploaded;
    expect(res.status()).toBe(201);
    expect(["image/webp", "image/jpeg"]).toContain(res.request().headers()["content-type"]);
    const stored = (await res.json()) as { image: { id: string; mime: string; width: number; height: number; size: number } };
    expect(stored.image).toMatchObject({ width: 384, height: 384 }); // la forma de «Persona» es un círculo: recorte cuadrado
    expect(stored.image.size).toBeLessThan(262_144);
    await expect(dialog).toBeHidden();

    // La vista previa del panel carga la imagen guardada.
    const preview = page.getByTestId("entity-image-preview");
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(384);

    // El rostro quedó CENTRADO en la imagen guardada (se vuelve a detectar sobre el resultado).
    const center = await page.evaluate(async (url) => {
      const modulePath = "/src/features/images/face-detector.ts";
      const mod = (await import(/* @vite-ignore */ modulePath)) as typeof import("../src/features/images/face-detector");
      const img = new Image();
      img.src = url;
      await img.decode();
      const faces = await mod.detectFaces(img);
      const f = faces[0];
      return f ? { cx: (f.x + f.width / 2) / img.naturalWidth, cy: (f.y + f.height / 2) / img.naturalHeight, w: f.width / img.naturalWidth } : null;
    }, `/api/v1/graphs/${graphId}/images/${stored.image.id}`);
    expect(center, "debe seguir viéndose un rostro tras el recorte").not.toBeNull();
    expect(Math.abs(center!.cx - 0.5)).toBeLessThan(0.12);
    expect(Math.abs(center!.cy - 0.5)).toBeLessThan(0.12);
    expect(center!.w).toBeGreaterThan(0.3); // el rostro es bien visible dentro del nodo

    // El lienzo ya no pinta el círculo azul con el icono: pinta la foto (tonos de piel en el centro del nodo).
    await expect.poll(async () => (await centerColors(page)).some((c) => !isBlue(c)), { timeout: 15_000 }).toBe(true);
    expect((await centerColors(page)).filter(isBlue).length).toBe(0);

    // Persiste: tras esperar el autoguardado y recargar, la imagen sigue en la entidad y en el lienzo.
    await expect(page.getByText(/Guardado/).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    await page.getByRole("list", { name: "Entidades" }).getByRole("button", { name: /Persona/ }).click();
    await expect(page.getByTestId("entity-image-preview")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect.poll(async () => (await centerColors(page)).some((c) => !isBlue(c)), { timeout: 15_000 }).toBe(true);

    // Quitar la imagen devuelve el icono (círculo azul) y se puede deshacer.
    await page.getByRole("button", { name: "Quitar imagen" }).click();
    await expect(page.getByTestId("entity-image-preview")).toHaveCount(0);
    await expect.poll(async () => (await centerColors(page)).some(isBlue), { timeout: 15_000 }).toBe(true);
    await page.getByRole("button", { name: "Deshacer (Ctrl+Z)" }).click();
    await expect(page.getByTestId("entity-image-preview")).toBeVisible();
    await expect.poll(async () => (await centerColors(page)).filter(isBlue).length, { timeout: 15_000 }).toBe(0);
  });

  test("sin rostro se centra la imagen y se puede ajustar a mano; el teclado mueve y amplía", async ({ page }) => {
    await openEditorWithPerson(page, "img2");
    await pick(page, { name: "paisaje.jpg", mimeType: "image/jpeg", buffer: await syntheticPhoto(page, { width: 800, height: 500, mime: "image/jpeg" }) });
    const dialog = page.getByRole("dialog", { name: /Recortar imagen/ });
    await expect(dialog.getByTestId("crop-message")).toHaveText(/No se detectó ningún rostro/, { timeout: 30_000 });
    await expect(dialog.getByRole("button", { name: "Centrar en el rostro" })).toBeDisabled();

    const zoom = dialog.getByRole("slider", { name: "Ampliación" });
    await expect(zoom).toHaveValue("1");
    const preview = dialog.getByTestId("crop-preview");
    await preview.focus();
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    expect(Number(await zoom.inputValue())).toBeGreaterThan(1.2);
    await dialog.getByRole("button", { name: "Restablecer" }).click();
    await expect(zoom).toHaveValue("1");

    // Cancelar no sube nada ni cambia la entidad.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("entity-image-preview")).toHaveCount(0);
  });

  test("rechaza archivos que no son imágenes admitidas, vacíos o dañados, con un mensaje claro", async ({ page }) => {
    await openEditorWithPerson(page, "img3");
    await pick(page, { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
    await expect(page.getByRole("alert").filter({ hasText: /Formato no admitido/ })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await pick(page, { name: "vacio.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
    await expect(page.getByRole("alert").filter({ hasText: /vacío/ })).toBeVisible();

    // Un «PNG» que no lo es: el diálogo se abre, no puede leerla y no deja confirmar.
    await pick(page, { name: "roto.png", mimeType: "image/png", buffer: Buffer.from("esto no es un png de verdad") });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText(/dañado|no es una imagen válida/);
    await expect(dialog.getByRole("button", { name: "Usar imagen" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByTestId("entity-image-preview")).toHaveCount(0);
  });
});

// ------------------------------------------------------------------------------------------------
// Exportaciones: la imagen de la entidad aparece en PNG/PDF/PowerPoint.
// ------------------------------------------------------------------------------------------------
const ORIGIN = "http://127.0.0.1:5273";

/** Grafo con 2 entidades, una de ellas con imagen subida por la API (rostro sintético centrado). */
async function seedWithImage(page: Page, tag: string) {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, "Grafo exportado con imagen");
  await page.goto("/login"); // una página cualquiera del mismo origen para dibujar la foto con un lienzo
  const photo = await syntheticPhoto(page, { width: 384, height: 384, fx: 192, fy: 192, face: 220 });
  const up = await page.request.post(`/api/v1/graphs/${id}/images`, { headers: { Origin: ORIGIN, "Content-Type": "image/png" }, data: photo });
  expect(up.status(), await up.text()).toBe(201);
  const imageId = ((await up.json()) as { image: { id: string } }).image.id;
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const node = (nid: string, label: string, over: object = {}) => ({ id: nid, type: "person", label, description: "", notes: "", tags: [], metadata: {}, imageId: null, positionX: null, positionY: null, ...over });
  const put = await api(page.request, "PUT", `/graphs/${id}/content`, {
    expectedRevision: 1,
    nodes: [node(a, "Con imagen", { imageId, positionX: 0, positionY: 0 }), node(b, "Sin imagen", { positionX: 220, positionY: 0 })],
    edges: [{ id: crypto.randomUUID(), sourceId: a, targetId: b, relationshipType: "contact", label: "", metadata: { direction: "forward", evidenceClass: "recorded" } }],
  });
  expect(put.status(), await put.text()).toBe(200);
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name: "Grafo exportado con imagen", level: 1 })).toBeVisible();
  return { id, imageId };
}

async function exportFile(page: Page, format: string, options: Record<string, string> = {}) {
  await page.getByRole("button", { name: /^Exportar/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
  await dialog.getByLabel("Formato").selectOption(format);
  for (const [label, value] of Object.entries(options)) await dialog.getByLabel(label, { exact: true }).selectOption(value);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
  return readFileSync(await download.path());
}

/** Cuenta los píxeles de «piel» (el rostro sintético) y los azules de «Persona» en una imagen PNG. */
async function countColors(page: Page, bytes: Buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let skin = 0;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (Math.abs(r - 241) < 14 && Math.abs(g - 194) < 14 && Math.abs(b - 125) < 18) skin++;
      if (b > r + 100 && b > 180 && r < 90) blue++;
    }
    return { skin, blue };
  }, bytes.toString("base64"));
}

test.describe("imágenes de las entidades en las exportaciones", () => {
  test("PowerPoint editable lleva la imagen recortada a la forma de cada entidad que la tiene (sin lienzo ni licencia)", async ({ page }) => {
    await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
    await seedWithImage(page, "imx1");
    const bytes = await exportFile(page, "pptx-editable");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\/.+\.png$/i.test(n));
    expect(media.length, "una imagen por entidad con imagen").toBe(1);
    const png = await zip.file(media[0]!)!.async("nodebuffer");
    const counts = await countColors(page, png);
    expect(counts.skin).toBeGreaterThan(500); // es el rostro sintético, no un marcador de posición
    // Recortada a la forma: el círculo de «Persona» deja las esquinas transparentes.
    const corner = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return [ctx.getImageData(2, 2, 1, 1).data[3]!, ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[3]!];
    }, png.toString("base64"));
    expect(corner).toEqual([0, 255]);
  });

  test("PNG exportado con el lienzo real muestra la imagen de la entidad y el icono de la que no tiene", async ({ page }) => {
    test.skip(!HAS_LICENSE, "Define ZOOMCHARTS_LICENSE y ZOOMCHARTS_LICENSE_KEY en .env.");
    test.setTimeout(120_000);
    await seedWithImage(page, "imx2");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    const png = await exportFile(page, "png", { Resolución: "2" });
    const counts = await countColors(page, png);
    expect(counts.skin, "la foto de la entidad se ve en la imagen exportada").toBeGreaterThan(300);
    expect(counts.blue, "la otra entidad conserva su círculo azul con icono").toBeGreaterThan(300);

    // Mismo resultado dentro de un PDF o un PowerPoint con imagen: son ficheros válidos y distintos del grafo sin imagen.
    const pdf = await exportFile(page, "pdf");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pptx = await exportFile(page, "pptx-image");
    expect(pptx[0]).toBe(0x50);
  });
});