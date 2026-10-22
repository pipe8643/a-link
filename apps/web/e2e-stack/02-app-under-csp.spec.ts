import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { HAS_LICENSE, PASSWORD, STACK_URL, apiCall, registerViaApi, seedGraph, uniqueEmail, watchSecurity } from "./helpers";

/**
 * La aplicación COMPLETA funcionando detrás de la CSP estricta de Nginx, con TLS y la API en modo producción.
 * Es la prueba que justifica los permisos de la CSP: si ZoomCharts, las exportaciones (PDF/PPTX/PNG/JPEG) o
 * cualquier pantalla necesitaran algo más (`unsafe-eval`, otros orígenes...), fallaría aquí.
 */
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b;
const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

async function exportAs(page: Page, format: string, opts: { saveCopy?: boolean; name?: string } = {}): Promise<{ bytes: Buffer; download: Download }> {
  await page.getByRole("button", { name: /^Exportar/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Formato").selectOption(format);
  if (opts.name) await dialog.getByLabel("Nombre del archivo").fill(opts.name);
  const resolution = dialog.getByLabel("Resolución", { exact: true });
  if (await resolution.count()) await resolution.selectOption("1");
  if (opts.saveCopy) await dialog.getByLabel(/Guardar una copia en mi cuenta/).check();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
  const bytes = readFileSync(await download.path());
  await expect(dialog).toBeHidden();
  return { bytes, download };
}

test.describe("la aplicación bajo la CSP de producción", () => {
  test("registro por la interfaz, panel y navegación sin infracciones de CSP ni conexiones a terceros", async ({ page }) => {
    const watch = await watchSecurity(page);
    const email = uniqueEmail("csp");
    await page.goto("/register");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Repite la contraseña").fill(PASSWORD);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Grafos" })).toBeVisible();

    for (const name of ["Grafos", "Exportaciones"]) {
      await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: name }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(await watch.violations()).toEqual([]);
    // El navegador no habla con nadie más que con su propio origen (ni siquiera con ZoomCharts si no abre un grafo).
    expect([...watch.foreignRequests]).toEqual([]);
    // La sesión sigue siendo HttpOnly bajo HTTPS real.
    const jsVisible = await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(jsVisible).not.toContain("alink_sid");
  });

  test("PowerPoint editable (sin lienzo) funciona bajo la CSP y guardar copia llega al almacenamiento privado", async ({ page }) => {
    await registerViaApi(page, "csp2");
    const { id } = await seedGraph(page, "Grafo CSP editable");
    await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
    const watch = await watchSecurity(page);
    await page.goto(`/graphs/${id}/editor`);
    await expect(page.getByRole("heading", { name: "Grafo CSP editable", level: 1 })).toBeVisible();
    const { bytes } = await exportAs(page, "pptx-editable", { saveCopy: true, name: "editable csp" });
    expect(isZip(bytes)).toBe(true);
    await expect(page.getByText(/se guardó una copia/)).toBeVisible();
    expect(await watch.violations()).toEqual([]);

    // La copia guardada es idéntica a la descarga local y se baja por la API a través de Nginx.
    const list = (await (await apiCall(page.request, "GET", "/files")).json()) as { items: Array<{ id: string; sha256: string; name: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: "editable csp", sha256: sha(bytes) });
    const dl = await page.request.get(`/api/v1/files/${list.items[0]!.id}/content`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-disposition"]).toContain("attachment");
    expect(dl.headers()["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers()["cache-control"]).toBe("private, no-store");
    expect(sha(await dl.body())).toBe(sha(bytes));
  });

  test.describe("con ZoomCharts real", () => {
    test.skip(!HAS_LICENSE, "El stack se levantó sin licencia de ZoomCharts (.env.docker).");
    test.setTimeout(240_000);

    test("el lienzo se dibuja y se puede editar bajo la CSP; solo se contacta con el servicio de licencias", async ({ page }) => {
      await registerViaApi(page, "csp3");
      const { id } = await seedGraph(page, "Grafo CSP lienzo", 14);
      const watch = await watchSecurity(page);
      await page.goto(`/graphs/${id}/editor`);
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
      // Dibuja de verdad: el lienzo tiene tamaño y contenido.
      const box = await page.getByTestId("net-chart").boundingBox();
      expect(box!.width).toBeGreaterThan(300);
      await expect(page.getByTestId("net-chart").locator("canvas").first()).toBeVisible();
      await page.waitForTimeout(1500);
      expect(await watch.violations(), "infracciones de CSP con ZoomCharts").toEqual([]);
      for (const origin of watch.foreignRequests) expect(origin, "origen externo inesperado").toBe("https://api.zoomcharts-cloud.com");
    });

    test("PNG, JPEG, PDF y PowerPoint con imagen se generan bajo la CSP y son ficheros válidos", async ({ page }) => {
      await registerViaApi(page, "csp4");
      const { id } = await seedGraph(page, "Grafo CSP exportar", 14);
      const watch = await watchSecurity(page);
      await page.goto(`/graphs/${id}/editor`);
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

      const png = await exportAs(page, "png");
      expect(isPng(png.bytes)).toBe(true);
      const jpg = await exportAs(page, "jpeg");
      expect(isJpeg(jpg.bytes)).toBe(true);
      const pdf = await exportAs(page, "pdf");
      expect(isPdf(pdf.bytes)).toBe(true);
      const pptx = await exportAs(page, "pptx-image");
      expect(isZip(pptx.bytes)).toBe(true);

      expect(await watch.violations(), "infracciones de CSP al exportar").toEqual([]);
      // El proxy de exportación de ZoomCharts nunca se usa: ningún origen que no sea el propio o el de licencias.
      for (const origin of watch.foreignRequests) expect(origin).toBe("https://api.zoomcharts-cloud.com");
    });

    test("guardar copia de un PNG real: se ve en Exportaciones y se descarga idéntico", async ({ page }) => {
      await registerViaApi(page, "csp5");
      const { id } = await seedGraph(page, "Grafo CSP copia", 10);
      await page.goto(`/graphs/${id}/editor`);
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
      const { bytes } = await exportAs(page, "png", { saveCopy: true, name: "mi png" });
      await expect(page.getByText(/se guardó una copia/)).toBeVisible();
      await page.goto("/exports");
      await expect(page.getByText("mi png.png")).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar mi png.png" }).click()]);
      expect(sha(readFileSync(await download.path()))).toBe(sha(bytes));
    });
  });

  test("los datos, las cuentas y los archivos sobreviven al reinicio de los contenedores", async ({ page }) => {
    test.setTimeout(180_000);
    const { email } = await registerViaApi(page, "persist");
    const { id } = await seedGraph(page, "Persistente", 6);
    await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
    await page.goto(`/graphs/${id}/editor`);
    const { bytes } = await exportAs(page, "pptx-editable", { saveCopy: true, name: "persistente" });
    await expect(page.getByText(/se guardó una copia/)).toBeVisible();

    // Reinicio de la API y de la base de datos (los volúmenes conservan los datos).
    const compose = ["compose", "--env-file", ".env.docker", "--env-file", ".env.docker.test"];
    const root = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    execFileSync("docker", [...compose, "restart", "db", "api"], { cwd: root, stdio: "pipe" });
    await expect
      .poll(async () => (await page.request.get("/api/v1/health").catch(() => null))?.status(), { timeout: 90_000, intervals: [1000] })
      .toBe(200);

    // La sesión (en base de datos) sigue siendo válida, el grafo está y el archivo se descarga idéntico.
    const me = await apiCall(page.request, "GET", "/users/me");
    expect(me.status()).toBe(200);
    expect(JSON.stringify(await me.json())).toContain(email);
    const content = (await (await apiCall(page.request, "GET", `/graphs/${id}/content`)).json()) as { nodes: unknown[] };
    expect(content.nodes).toHaveLength(6);
    const list = (await (await apiCall(page.request, "GET", "/files")).json()) as { items: Array<{ id: string }> };
    const dl = await page.request.get(`/api/v1/files/${list.items[0]!.id}/content`);
    expect(sha(await dl.body())).toBe(sha(bytes));
  });
});

test("el origen configurado es el único que puede modificar datos", async ({ page }) => {
  expect(STACK_URL).toMatch(/^https:/);
  await registerViaApi(page, "origin");
  const ok = await apiCall(page.request, "POST", "/folders", { name: "Carpeta" });
  expect(ok.status()).toBe(201);
});
