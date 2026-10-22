import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Enlaces de solo lectura y PowerPoint interactivo. El visor `/s#token` no usa la sesión; el token viaja en el
 * fragmento. PowerPoint interactivo crea un enlace de 7 días y un .pptx con la URL (no un gráfico ZoomCharts ejecutable).
 */
test.describe("compartir grafo", () => {
  test("crear enlace, verlo sin sesión, revocar y dejar de funcionar; B no lista los de A", async ({ page, browser }) => {
    const { email } = await registerViaApi(page, "sh1");
    const id = await createGraphViaApi(page, "Caso compartido");
    const put = await api(page.request, "PUT", `/graphs/${id}/content`, {
      expectedRevision: 1,
      nodes: [{ id: crypto.randomUUID(), type: "person", label: "Ana Pública", description: "", notes: "SECRETO", tags: [], metadata: {}, imageId: null, positionX: 0, positionY: 0 }],
      edges: [],
    });
    expect(put.status()).toBe(200);
    await page.goto(`/graphs/${id}/editor`);
    await expect(page.getByRole("heading", { name: "Caso compartido", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Compartir…" }).click();
    const share = page.getByRole("dialog", { name: "Compartir grafo" });
    await expect(share).toBeVisible();
    await share.getByRole("button", { name: "Crear enlace" }).click();
    const url = await share.getByLabel("Enlace de solo lectura").inputValue();
    expect(url).toMatch(/\/s#[A-Za-z0-9_-]{43}$/);

    const listed = await api(page.request, "GET", `/graphs/${id}/shares`);
    expect(listed.status()).toBe(200);
    const items = ((await listed.json()) as { items: Array<{ id: string }> }).items;
    expect(items).toHaveLength(1);

    const visitor = await browser.newContext();
    const view = await visitor.newPage();
    await view.goto(url);
    await expect(view.getByRole("heading", { name: "Caso compartido" })).toBeVisible();
    await expect(view.getByText("Ana Pública")).toBeVisible();
    await expect(view.getByText("SECRETO")).toHaveCount(0); // las notas no salen por el enlace
    await view.getByRole("button", { name: "Ajustar a la vista" }).click();
    expect(view.url()).toContain("#");
    await visitor.close();

    const other = await browser.newContext();
    const b = await other.newPage();
    await registerViaApi(b, "sh1b");
    expect((await api(b.request, "GET", `/graphs/${id}/shares`)).status()).toBe(404);
    await other.close();

    await share.getByRole("button", { name: "Revocar" }).click();
    await expect(share.getByText("Revocado")).toBeVisible();
    const after = await browser.newContext();
    const dead = await after.newPage();
    await dead.goto(url);
    await expect(dead.getByRole("heading", { name: "Enlace no disponible" })).toBeVisible();
    await after.close();
    void email;
  });

  test("PowerPoint interactivo crea el enlace y un .pptx con la URL (sin el token en metadatos)", async ({ page }) => {
    test.setTimeout(90_000);
    await registerViaApi(page, "sh2");
    const id = await createGraphViaApi(page, "Informe vivo");
    const put = await api(page.request, "PUT", `/graphs/${id}/content`, {
      expectedRevision: 1,
      nodes: [{ id: crypto.randomUUID(), type: "person", label: "Nodo", description: "", notes: "", tags: [], metadata: {}, imageId: null, positionX: 0, positionY: 0 }],
      edges: [],
    });
    expect(put.status()).toBe(200);
    await page.goto(`/graphs/${id}/editor`);
    await page.getByRole("button", { name: /^Exportar/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
    await dialog.getByLabel("Formato").selectOption("pptx-live");
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
    const bytes = readFileSync(await download.path());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
    const xml = (await zip.file("ppt/slides/slide2.xml")!.async("string")) + (await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"));
    expect(xml).toContain("Web Viewer");
    expect(xml).toMatch(/\/s#/);
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("A-Link");
    const token = /\/s#([A-Za-z0-9_-]{43})/.exec(xml)?.[1];
    expect(token).toBeDefined();
    expect(core).not.toContain(token);
    const shares = await (await api(page.request, "GET", `/graphs/${id}/shares`)).json() as { items: unknown[] };
    expect(shares.items.length).toBeGreaterThanOrEqual(1);
  });
});
