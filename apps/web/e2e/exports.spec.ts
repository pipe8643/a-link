import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Almacenamiento privado de exportaciones, de extremo a extremo (API real + MySQL de pruebas + disco local).
 * Se usa PowerPoint editable porque no necesita licencia de ZoomCharts (se construye con las posiciones guardadas).
 * La copia en la cuenta es opcional: aquí se comprueba tanto que NO se sube por defecto como que, al elegirla,
 * el archivo guardado es byte a byte el que se descargó, y que otra cuenta no puede verlo ni alcanzarlo.
 */
const BASE = "http://127.0.0.1:5273";
const COPY_LABEL = "Guardar una copia en mi cuenta (Exportaciones)";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface ApiFile {
  id: string;
  name: string;
  format: string;
  fileSize: number;
  sha256: string;
}

async function seedGraph(page: Page, tag: string, name: string) {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, name);
  const nodes = Array.from({ length: 4 }, (_, i) => ({
    id: crypto.randomUUID(),
    type: "person",
    label: `Persona ${i}`,
    description: "",
    notes: "",
    tags: [],
    metadata: {},
    positionX: i * 200,
    positionY: (i % 2) * 150,
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: crypto.randomUUID(),
    sourceId: nodes[i]!.id,
    targetId: n.id,
    relationshipType: "contact",
    label: "",
    metadata: { direction: "forward", evidenceClass: "recorded" },
  }));
  const put = await api(page.request, "PUT", `/graphs/${id}/content`, { expectedRevision: 1, nodes, edges });
  expect(put.status(), await put.text()).toBe(200);
  return id;
}

/** Exporta a PowerPoint editable desde el editor; devuelve los bytes descargados en el equipo. */
async function exportPptx(page: Page, graphId: string, fileName: string, saveCopy: boolean): Promise<Buffer> {
  await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
  await page.goto(`/graphs/${graphId}/editor`);
  await page.getByRole("button", { name: /^Exportar/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Formato").selectOption("pptx-editable");
  await dialog.getByLabel("Nombre del archivo").fill(fileName);
  const copy = dialog.getByLabel(COPY_LABEL);
  await expect(copy).not.toBeChecked(); // por defecto, nada sale del equipo
  if (saveCopy) await copy.check();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
  await expect(dialog).toBeHidden();
  return readFileSync(await download.path());
}

const listFiles = async (page: Page) => {
  const res = await api(page.request, "GET", "/files");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: ApiFile[] }).items;
};

test.describe("exportaciones guardadas en la cuenta", () => {
  test("por defecto no se guarda nada y la página lo explica", async ({ page }) => {
    const id = await seedGraph(page, "xs0", "Solo descarga");
    const local = await exportPptx(page, id, "solo local", false);
    expect(local.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(await listFiles(page)).toHaveLength(0);
    await page.goto("/exports");
    await expect(page.getByRole("heading", { name: "Exportaciones", level: 1 })).toBeVisible();
    await expect(page.getByText("Aún no has guardado exportaciones")).toBeVisible();
  });

  test("guardar copia, verla, descargarla idéntica, renombrarla y eliminarla", async ({ page }) => {
    const id = await seedGraph(page, "xs1", "Caso con copia");
    const local = await exportPptx(page, id, "informe", true);
    await expect(page.getByText(/se guardó una copia/)).toBeVisible();

    // El archivo guardado es exactamente el descargado (huella SHA-256 y tamaño).
    const [stored] = await listFiles(page);
    expect(stored).toMatchObject({ name: "informe", format: "pptx", fileSize: local.length, sha256: sha(local) });
    expect(JSON.stringify(stored)).not.toMatch(/ownerId|storageKey/);

    await page.goto("/exports");
    const row = page.getByRole("listitem").filter({ hasText: "informe.pptx" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: "Caso con copia" })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar informe.pptx" }).click()]);
    expect(download.suggestedFilename()).toBe("informe.pptx");
    expect(sha(readFileSync(await download.path()))).toBe(sha(local));

    // Renombrar.
    await page.getByRole("button", { name: "Renombrar informe.pptx" }).click();
    const rename = page.getByRole("dialog");
    await rename.getByLabel("Nombre").fill("Informe v2");
    await rename.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Informe v2.pptx")).toBeVisible();
    await expect(page.getByText("informe.pptx", { exact: true })).toHaveCount(0);

    // Eliminar con confirmación.
    await page.getByRole("button", { name: "Eliminar Informe v2.pptx" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText("Aún no has guardado exportaciones")).toBeVisible();
    expect(await listFiles(page)).toHaveLength(0);
  });

  test("si el servidor rechaza la copia, la descarga local se hace igualmente y se avisa", async ({ page }) => {
    const id = await seedGraph(page, "xs2", "Fallo de copia");
    await page.route("**/api/v1/graphs/*/exports", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL_ERROR", message: "Error interno del servidor." }) })
        : route.continue(),
    );
    const local = await exportPptx(page, id, "con fallo", true);
    expect(local.length).toBeGreaterThan(1000);
    await expect(page.getByText(/no se pudo guardar la copia/)).toBeVisible();
    expect(await listFiles(page)).toHaveLength(0);
  });

  test("B no ve, descarga, renombra ni borra los archivos de A, y recibe lo mismo que ante un id inexistente", async ({ page, browser }) => {
    const id = await seedGraph(page, "xs3", "Grafo de A");
    const local = await exportPptx(page, id, "privado de A", true);
    const [file] = await listFiles(page);
    expect(file).toBeDefined();

    const ctxB = await browser.newContext({ baseURL: BASE });
    try {
      const b = await ctxB.newPage();
      await registerViaApi(b, "xs3b");
      expect(await listFiles(b)).toHaveLength(0);
      await b.goto("/exports");
      await expect(b.getByText("Aún no has guardado exportaciones")).toBeVisible();
      await expect(b.getByText("privado de A")).toHaveCount(0);

      const ghost = crypto.randomUUID();
      for (const [method, suffix, data] of [
        ["GET", "", undefined],
        ["GET", "/content", undefined],
        ["PATCH", "", { name: "robado" }],
        ["DELETE", "", undefined],
      ] as const) {
        const real = await api(b.request, method, `/files/${file!.id}${suffix}`, data);
        const none = await api(b.request, method, `/files/${ghost}${suffix}`, data);
        expect(real.status(), `${method} ${suffix}`).toBe(404);
        expect(none.status()).toBe(404);
        // Mismo cuerpo salvo el identificador de la petición (distinto en cada una).
        const strip = (o: object) => ({ ...o, requestId: undefined });
        expect(strip(await real.json())).toEqual(strip(await none.json()));
      }
      // B tampoco puede subir al grafo de A.
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
      const up = await b.request.fetch(`/api/v1/graphs/${id}/exports`, { method: "POST", headers: { Origin: BASE, "Content-Type": "image/png", "X-Export-Name": "intruso" }, data: png });
      expect(up.status()).toBe(404);
    } finally {
      await ctxB.close();
    }

    // Tras los intentos de B, el archivo de A sigue intacto.
    const after = await listFiles(page);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ name: "privado de A", sha256: sha(local) });
  });

  test("sin sesión no hay acceso a la lista ni al contenido", async ({ page }) => {
    const res = await page.request.get("/api/v1/files");
    expect(res.status()).toBe(401);
    const content = await page.request.get(`/api/v1/files/${crypto.randomUUID()}/content`);
    expect(content.status()).toBe(401);
  });
});
