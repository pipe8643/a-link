import { expect, test, type Page } from "@playwright/test";
import { createFolderViaApi, createGraphViaApi, registerViaApi } from "./helpers";

const folderNav = (page: Page) => page.getByRole("navigation", { name: "Carpetas" });
const graphMenu = (page: Page, name: string) => page.getByRole("button", { name: `Acciones de ${name}` });
const folderMenu = (page: Page, name: string) => page.getByRole("button", { name: `Acciones de la carpeta ${name}` });

async function newGraphViaDialog(page: Page, name: string, opts: { description?: string; folder?: string } = {}) {
  await page.getByRole("button", { name: "Nuevo grafo" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grafo" });
  await dialog.getByLabel("Nombre").fill(name);
  if (opts.description) await dialog.getByLabel("Descripción (opcional)").fill(opts.description);
  if (opts.folder) await dialog.getByLabel("Carpeta").selectOption({ label: opts.folder });
  await dialog.getByRole("button", { name: "Crear grafo" }).click();
  await expect(page.getByText("Grafo creado").first()).toBeVisible(); // puede quedar a la vista el aviso del grafo anterior
  // Tras crear, la aplicación abre la ficha del grafo nuevo; volvemos a la lista por la navegación lateral.
  await expect(page).toHaveURL(/\/graphs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Grafos" }).click();
  await expect(page).toHaveURL(/\/graphs$/);
}

test.describe("biblioteca: carpetas y grafos", () => {
  test("carpetas: crear, subcarpeta, renombrar, mover y eliminar conservando el contenido", async ({ page }) => {
    await registerViaApi(page, "carpetas");
    await page.goto("/graphs");

    // Crear carpeta raíz
    await folderNav(page).getByRole("button", { name: "Nueva", exact: true }).click();
    await page.getByRole("dialog", { name: "Nueva carpeta" }).getByLabel("Nombre").fill("Caso Norte");
    await page.getByRole("dialog").getByRole("button", { name: /Crear/ }).click();
    await expect(page.getByText("Carpeta creada")).toBeVisible();
    await expect(folderNav(page).getByText("Caso Norte")).toBeVisible();

    // Subcarpeta
    await folderMenu(page, "Caso Norte").click();
    await page.getByRole("menuitem", { name: "Nueva subcarpeta" }).click();
    await page.getByRole("dialog", { name: "Nueva subcarpeta" }).getByLabel("Nombre").fill("Telecom");
    await page.getByRole("dialog").getByRole("button", { name: /Crear/ }).click();
    await expect(folderNav(page).getByText("Telecom")).toBeVisible();

    // Renombrar
    await folderMenu(page, "Caso Norte").click();
    await page.getByRole("menuitem", { name: "Renombrar" }).click();
    const rename = page.getByRole("dialog", { name: "Renombrar carpeta" });
    await rename.getByLabel("Nombre").fill("Caso Norte 2026");
    await rename.getByRole("button", { name: /Guardar|Renombrar/ }).click();
    await expect(folderNav(page).getByText("Caso Norte 2026")).toBeVisible();

    // Nombre vacío: se valida en el cliente y el diálogo sigue abierto.
    await folderNav(page).getByRole("button", { name: "Nueva", exact: true }).click();
    await page.getByRole("dialog", { name: "Nueva carpeta" }).getByLabel("Nombre").fill("   ");
    await page.getByRole("dialog").getByRole("button", { name: /Crear/ }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    // Mover "Telecom" a la raíz: el selector no ofrece su propio subárbol.
    await folderMenu(page, "Telecom").click();
    await page.getByRole("menuitem", { name: /Mover/ }).click();
    const move = page.getByRole("dialog", { name: /Mover «Telecom»/ });
    await move.getByLabel("Carpeta de destino").selectOption({ label: "Raíz (sin carpeta padre)" });
    await move.getByRole("button", { name: "Mover" }).click();
    await expect(page.getByText("Carpeta movida")).toBeVisible();

    // Eliminar "Caso Norte 2026" (con un grafo dentro) conservando el contenido: el grafo sube a la raíz.
    await newGraphViaDialog(page, "Grafo en caso", { folder: "Caso Norte 2026" });
    await folderMenu(page, "Caso Norte 2026").click();
    await page.getByRole("menuitem", { name: /Eliminar/ }).click();
    const del = page.getByRole("dialog", { name: /Eliminar «Caso Norte 2026»/ });
    await expect(del).toContainText("1 grafo activo");
    await del.getByRole("button", { name: "Eliminar carpeta" }).click();
    await expect(page.getByText("Carpeta eliminada")).toBeVisible();
    await expect(folderNav(page).getByText("Caso Norte 2026")).toHaveCount(0);

    await page.getByRole("button", { name: /Todos los grafos/ }).first().click();
    await expect(page.getByRole("link", { name: "Abrir Grafo en caso" })).toBeVisible();
  });

  test("grafos: crear, buscar, editar, duplicar, papelera con deshacer, restaurar y borrar definitivamente", async ({ page }) => {
    await registerViaApi(page, "grafos");
    await page.goto("/graphs");
    await expect(page.getByText("Crea tu primer grafo")).toBeVisible();

    await newGraphViaDialog(page, "Red de contactos", { description: "Datos sintéticos" });
    await newGraphViaDialog(page, "Otro caso");
    await expect(page.getByRole("link", { name: "Abrir Red de contactos" })).toBeVisible();

    // Búsqueda con debounce, reflejada en la URL; luego se borra.
    await page.getByRole("searchbox", { name: "Buscar grafos" }).fill("contactos");
    await expect(page).toHaveURL(/q=contactos/);
    await expect(page.getByRole("link", { name: "Abrir Otro caso" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Abrir Red de contactos" })).toBeVisible();
    await page.getByRole("button", { name: "Borrar búsqueda" }).click();
    await expect(page.getByRole("link", { name: "Abrir Otro caso" })).toBeVisible();

    // Una búsqueda sin resultados no es lo mismo que "no tienes grafos".
    await page.getByRole("searchbox", { name: "Buscar grafos" }).fill("zzz-no-existe");
    await expect(page.getByText("No hay grafos que coincidan")).toBeVisible();
    await page.getByRole("button", { name: "Borrar búsqueda" }).click();

    // Editar
    await graphMenu(page, "Otro caso").click();
    await page.getByRole("menuitem", { name: "Editar detalles" }).click();
    const edit = page.getByRole("dialog", { name: "Editar grafo" });
    await edit.getByLabel("Nombre").fill("Caso renombrado");
    await edit.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Cambios guardados")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir Caso renombrado" })).toBeVisible();

    // Duplicar
    await graphMenu(page, "Caso renombrado").click();
    await page.getByRole("menuitem", { name: "Duplicar" }).click();
    await expect(page.getByText(/Copia creada/)).toBeVisible();

    // Papelera con "Deshacer"
    await graphMenu(page, "Red de contactos").click();
    await page.getByRole("menuitem", { name: "Enviar a la papelera" }).click();
    await expect(page.getByText("«Red de contactos» enviado a la papelera")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir Red de contactos" })).toHaveCount(0);
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("«Red de contactos» restaurado")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir Red de contactos" })).toBeVisible();

    // Papelera → restaurar
    await graphMenu(page, "Red de contactos").click();
    await page.getByRole("menuitem", { name: "Enviar a la papelera" }).click();
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Papelera" }).click();
    await expect(page.getByRole("main").getByText("Red de contactos")).toBeVisible();
    await page.getByRole("button", { name: "Restaurar" }).click();
    await expect(page.getByText("La papelera está vacía")).toBeVisible();

    // Papelera → borrado definitivo con confirmación
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Grafos" }).click();
    await graphMenu(page, "Red de contactos").click();
    await page.getByRole("menuitem", { name: "Enviar a la papelera" }).click();
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Papelera" }).click();
    await page.getByRole("button", { name: /Borrar/ }).first().click();
    const confirm = page.getByRole("dialog", { name: /Borrar «Red de contactos» definitivamente/ });
    await confirm.getByRole("button", { name: "Borrar definitivamente" }).click();
    await expect(page.getByText("Grafo eliminado definitivamente")).toBeVisible();
    await expect(page.getByText("La papelera está vacía")).toBeVisible();
  });

  test("vista de lista y paginación persisten al recargar; el estado vive en la URL", async ({ page }) => {
    await registerViaApi(page, "paginas");
    for (let i = 1; i <= 14; i++) await createGraphViaApi(page, `Grafo ${String(i).padStart(2, "0")}`);
    await page.goto("/graphs?sort=name-asc");

    await expect(page.getByRole("link", { name: /Grafo \d\d/ })).toHaveCount(12);
    const nav = page.getByRole("navigation", { name: "Paginación" });
    await nav.getByRole("button", { name: /Siguiente/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("link", { name: /Grafo \d\d/ })).toHaveCount(2);

    await page.getByRole("button", { name: "Vista de lista" }).click();
    await page.reload();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("button", { name: "Vista de lista" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: /Grafo \d\d/ })).toHaveCount(2);
  });

  test("la ficha del grafo muestra sus datos y enlaza al editor", async ({ page }) => {
    await registerViaApi(page, "ficha");
    const id = await createGraphViaApi(page, "Ficha de prueba");
    await page.goto(`/graphs/${id}`);
    await expect(page.getByRole("heading", { name: "Ficha de prueba", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir editor" })).toHaveAttribute("href", `/graphs/${id}/editor`);

    // Identificador mal formado: ni siquiera llega a la API.
    const calls: string[] = [];
    page.on("request", (r) => r.url().includes("/api/v1/graphs/") && calls.push(r.url()));
    await page.goto("/graphs/no-es-un-uuid");
    await expect(page.getByText("No encontramos lo que buscas")).toBeVisible();
    expect(calls).toEqual([]);
  });
});

test.describe("aislamiento entre cuentas (visto desde la interfaz)", () => {
  test("B no ve ni alcanza los grafos y carpetas de A, y recibe lo mismo que ante un id inexistente", async ({ browser }) => {
    const ctxA = await browser.newContext({ baseURL: "http://127.0.0.1:5273" });
    const ctxB = await browser.newContext({ baseURL: "http://127.0.0.1:5273" });
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    await registerViaApi(a, "usuarioA");
    const folderA = await createFolderViaApi(a, "Carpeta secreta de A");
    const graphA = await createGraphViaApi(a, "Grafo secreto de A", folderA);

    await registerViaApi(b, "usuarioB");
    await createGraphViaApi(b, "Grafo de B");

    // La lista de B solo tiene lo suyo, también al buscar por el nombre del de A.
    await b.goto("/graphs?q=secreto");
    await expect(b.getByText("No hay grafos que coincidan")).toBeVisible();
    await b.goto("/graphs");
    await expect(b.getByRole("link", { name: "Abrir Grafo de B" })).toBeVisible();
    await expect(b.getByText("Grafo secreto de A")).toHaveCount(0);
    await expect(b.getByText("Carpeta secreta de A")).toHaveCount(0);

    // Abrir directamente el id de A: pantalla "no encontrado" (idéntica a un id inexistente).
    await b.goto(`/graphs/${graphA}`);
    await expect(b.getByText("No encontramos lo que buscas")).toBeVisible();
    await expect(b.getByText("Grafo secreto de A")).toHaveCount(0);

    // Y por la API: 404 idéntico para ajeno e inexistente; ningún método modifica lo de A.
    const ghost = "00000000-0000-4000-8000-000000000000";
    const origin = { Origin: "http://127.0.0.1:5273" };
    const foreign = await b.request.get(`/api/v1/graphs/${graphA}`);
    const missing = await b.request.get(`/api/v1/graphs/${ghost}`);
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    const fb = (await foreign.json()) as { code: string; message: string };
    const mb = (await missing.json()) as { code: string; message: string };
    expect({ code: fb.code, message: fb.message }).toEqual({ code: mb.code, message: mb.message });
    expect((await b.request.patch(`/api/v1/graphs/${graphA}`, { headers: origin, data: { name: "hackeado" } })).status()).toBe(404);
    expect((await b.request.delete(`/api/v1/graphs/${graphA}`, { headers: origin })).status()).toBe(404);
    expect((await b.request.delete(`/api/v1/folders/${folderA}`, { headers: origin })).status()).toBe(404);
    expect((await b.request.post(`/api/v1/graphs/${graphA}/duplicate`, { headers: origin, data: {} })).status()).toBe(404);

    // Crear un grafo en la carpeta de A tampoco funciona.
    const intruso = await b.request.post("/api/v1/graphs", { headers: origin, data: { name: "intruso", folderId: folderA } });
    expect([403, 404]).toContain(intruso.status());

    // A sigue viendo su grafo intacto.
    await a.goto(`/graphs/${graphA}`);
    await expect(a.getByRole("heading", { name: "Grafo secreto de A", level: 1 })).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  test("al caducar/revocarse la sesión, la interfaz vuelve al login sin dejar datos a la vista", async ({ page }) => {
    await registerViaApi(page, "expira");
    await createGraphViaApi(page, "Dato privado");
    await page.goto("/graphs");
    await expect(page.getByRole("link", { name: "Abrir Dato privado" })).toBeVisible();

    await page.context().clearCookies(); // equivale a que el servidor ya no reconozca la sesión
    await page.getByRole("searchbox", { name: "Buscar grafos" }).fill("dato"); // provoca una petición → 401
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Dato privado")).toHaveCount(0);
  });
});
