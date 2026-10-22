import { expect, test, type Page } from "@playwright/test";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Editor de grafos. Las pruebas de la primera parte usan SOLO los paneles (listas, formularios, diálogo): así
 * demuestran que el editor funciona aunque el lienzo no cargue. Las de la segunda parte necesitan una licencia
 * real de ZoomCharts (ZOOMCHARTS_LICENSE en .env) y se omiten de forma explícita si no existe.
 */
async function openEditor(page: Page, tag: string, name = "Grafo de prueba") {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, name);
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return id;
}

const addEntity = (page: Page, typeName: string) => page.getByRole("button", { name: new RegExp(`^${typeName}.*añadir`) }).click();

test.describe("editor: entidades y relaciones desde los paneles", () => {
  test("crear, editar, relacionar, deshacer y eliminar", async ({ page }) => {
    await openEditor(page, "ed1");
    await expect(page.getByText("Todavía no hay entidades")).toBeVisible();

    // Crear una persona: queda seleccionada y su formulario aparece.
    await addEntity(page, "Persona");
    const entities = page.getByRole("list", { name: "Entidades" });
    await expect(entities.getByRole("button", { name: /Persona/ })).toHaveCount(1);
    await page.getByLabel("Nombre en el grafo").fill("Ana Prueba");
    await page.getByLabel("Alias").fill("Anita");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(entities.getByRole("button", { name: /Ana Prueba/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ana Prueba", level: 2 })).toBeVisible();

    // Un teléfono y su validación específica del tipo.
    await addEntity(page, "Teléfono");
    await page.getByLabel("Nombre en el grafo").fill("Línea de Ana");
    await page.getByLabel("Número").fill("abc");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(page.getByText("Número de teléfono no válido.")).toBeVisible();
    // Con error, la entidad conserva su nombre anterior.
    await expect(entities.getByRole("button", { name: /Línea de Ana/ })).toHaveCount(0);
    await page.getByLabel("Número").fill("+54 11 5555-0100");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(entities.getByRole("button", { name: /Línea de Ana/ })).toBeVisible();

    // Relación por el modo «conectar» usando las listas (alternativa accesible al lienzo).
    await entities.getByRole("button", { name: /Ana Prueba/ }).click();
    await page.getByRole("button", { name: /Modo conectar/ }).click();
    await expect(page.getByText(/Origen: Ana Prueba/)).toBeVisible();
    await entities.getByRole("button", { name: /Línea de Ana/ }).click();

    const dialog = page.getByRole("dialog", { name: "Nueva relación" });
    await expect(dialog.getByLabel("Origen")).toHaveValue(/.+/);
    await expect(dialog.getByLabel("Destino")).toHaveValue(/.+/);
    // Por defecto, hipótesis: nada se presume verificado.
    await expect(dialog.getByLabel("Naturaleza del dato")).toHaveValue("hypothesis");
    await dialog.getByLabel("Tipo de relación").selectOption("device_usage");
    await dialog.getByLabel("Confianza (0–100)").fill("80");
    await dialog.getByRole("button", { name: "Crear relación" }).click();
    await expect(dialog).toBeHidden();

    // La relación aparece en el panel de detalles y en la pestaña de relaciones.
    await expect(page.getByRole("heading", { name: "Uso de dispositivo", level: 2 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Detalles" }).getByText("Hipótesis")).toBeVisible();
    await page.getByRole("tab", { name: /Relaciones \(1\)/ }).click();
    await expect(page.getByRole("list", { name: "Relaciones" }).getByRole("button")).toHaveCount(1);

    // Editar la relación.
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Editar relación" });
    await edit.getByLabel("Naturaleza del dato").selectOption("recorded");
    await edit.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("complementary", { name: "Detalles" }).getByText("Dato registrado")).toBeVisible();

    // Eliminar una entidad borra sus relaciones, y deshacer lo recupera todo.
    await page.getByRole("tab", { name: /Entidades/ }).click();
    await entities.getByRole("button", { name: /Ana Prueba/ }).click();
    await page.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(page.getByRole("tab", { name: /Entidades \(1\)/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Relaciones \(0\)/ })).toBeVisible();
    await page.getByRole("button", { name: "Deshacer", exact: true }).first().click();
    await expect(page.getByRole("tab", { name: /Entidades \(2\)/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Relaciones \(1\)/ })).toBeVisible();
  });

  test("atajos de teclado: Ctrl+Z, Ctrl+Y y Supr; no actúan al escribir", async ({ page }) => {
    await openEditor(page, "ed2");
    await addEntity(page, "Persona");
    await addEntity(page, "Persona");
    const entities = page.getByRole("list", { name: "Entidades" });
    await expect(entities.getByRole("button")).toHaveCount(2);

    // Escribiendo en un campo, Supr/Ctrl+Z son del campo, no del editor.
    await page.getByLabel("Nombre en el grafo").focus();
    await page.keyboard.press("Control+z");
    await expect(entities.getByRole("button")).toHaveCount(2);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(entities.getByRole("button")).toHaveCount(1);
    await page.keyboard.press("Control+y");
    await expect(entities.getByRole("button")).toHaveCount(2);
    await page.keyboard.press("Delete");
    await expect(entities.getByRole("button")).toHaveCount(1);
  });

  test("validación del nombre y de relaciones inválidas", async ({ page }) => {
    await openEditor(page, "ed3");
    await addEntity(page, "Persona");
    await page.getByLabel("Nombre en el grafo").fill("   ");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(page.getByText("El nombre es obligatorio.")).toBeVisible();

    await addEntity(page, "Vehículo");
    await page.getByLabel("Matrícula").fill("@@");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(page.getByText(/La matrícula solo admite/)).toBeVisible();

    // Auto-relación rechazada en el diálogo.
    await page.getByRole("button", { name: "Nueva relación…" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nueva relación" });
    const origin = dialog.getByLabel("Origen");
    const first = await origin.locator("option").nth(1).getAttribute("value");
    await origin.selectOption(first!);
    await dialog.getByLabel("Destino").selectOption(first!);
    await dialog.getByRole("button", { name: "Crear relación" }).click();
    await expect(dialog.getByText("Una relación debe unir dos entidades distintas.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("tab", { name: /Relaciones \(0\)/ })).toBeVisible();
  });

  test("filtros: la búsqueda y el tipo acotan la lista", async ({ page }) => {
    await openEditor(page, "ed4");
    await addEntity(page, "Persona");
    await addEntity(page, "Vehículo");
    await addEntity(page, "Teléfono");
    const entities = page.getByRole("list", { name: "Entidades" });
    await expect(entities.getByRole("button")).toHaveCount(3);
    await page.getByLabel("Filtrar por tipo").selectOption("vehicle");
    await expect(entities.getByRole("button")).toHaveCount(1);
    await page.getByLabel("Filtrar por tipo").selectOption("");
    await page.getByLabel("Buscar en el grafo").fill("zzz");
    await expect(page.getByText("Ninguna entidad coincide")).toBeVisible();
  });

  test("si el lienzo no puede inicializarse (licencia no verificable), el editor sigue funcionando", async ({ page }) => {
    // Se impide la validación de la licencia: ZoomCharts destruye su objeto interno después de crearlo.
    await page.route("**://api.zoomcharts-cloud.com/**", (route) => route.abort());
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openEditor(page, "ed7");
    await addEntity(page, "Persona");
    await addEntity(page, "Organización");
    await page.getByLabel("Nombre en el grafo").fill("Empresa Demo");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await page.waitForTimeout(3500); // más que el tiempo de espera del lienzo
    // Nunca aparece la pantalla de error de la aplicación y los paneles siguen operativos.
    await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Entidades" }).getByRole("button", { name: /Empresa Demo/ })).toBeVisible();
    await addEntity(page, "Vehículo");
    await expect(page.getByRole("tab", { name: /Entidades \(3\)/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("avisa de cambios sin guardar al intentar cerrar, y deja de avisar cuando están guardados", async ({ page }) => {
    await openEditor(page, "ed5");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    await addEntity(page, "Persona");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "dirty");
    const beforeUnloadPrevented = () =>
      page.evaluate(() => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
    await expect.poll(beforeUnloadPrevented).toBe(true);
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "saved");
    await expect.poll(beforeUnloadPrevented).toBe(false); // el manejador se actualiza tras pintar el estado: se espera, no se supone
  });
});

const saveStatus = (page: Page) => page.locator("[data-save-status]");
const expectStatus = (page: Page, status: string) => expect(saveStatus(page)).toHaveAttribute("data-save-status", status, { timeout: 15_000 });
const ORIGIN = "http://127.0.0.1:5273";

async function rename(page: Page, name: string) {
  await page.getByLabel("Nombre en el grafo").fill(name);
  await page.getByRole("button", { name: "Aplicar cambios" }).click();
}

async function serverContent(page: Page, graphId: string) {
  const res = await page.request.get(`/api/v1/graphs/${graphId}/content`);
  expect(res.status()).toBe(200);
  return (await res.json()) as { revision: number; nodes: Array<{ label: string }>; edges: Array<{ relationshipType: string; metadata: { evidenceClass: string } }> };
}

test.describe("editor: guardado automático y persistencia", () => {
  test("lo que se crea se guarda solo y sobrevive a recargar la página", async ({ page }) => {
    const id = await openEditor(page, "sv1");
    await addEntity(page, "Persona");
    await rename(page, "Ana Persistente");
    await addEntity(page, "Teléfono");
    await rename(page, "Línea de Ana");
    const entities = page.getByRole("list", { name: "Entidades" });
    await entities.getByRole("button", { name: /Ana Persistente/ }).click();
    await page.getByRole("button", { name: /Modo conectar/ }).click();
    await entities.getByRole("button", { name: /Línea de Ana/ }).click();
    await page.getByRole("dialog", { name: "Nueva relación" }).getByRole("button", { name: "Crear relación" }).click();

    await expectStatus(page, "saved");
    const saved = await serverContent(page, id);
    expect(saved.nodes.map((n) => n.label).sort()).toEqual(["Ana Persistente", "Línea de Ana"]);
    expect(saved.edges).toHaveLength(1);
    expect(saved.edges[0]!.metadata.evidenceClass).toBe("hypothesis"); // el valor por defecto se conserva

    await page.reload();
    await expect(page.getByRole("heading", { name: "Grafo de prueba", level: 1 })).toBeVisible();
    await expect(entities.getByRole("button", { name: /Ana Persistente/ })).toBeVisible();
    await expect(entities.getByRole("button", { name: /Línea de Ana/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Relaciones \(1\)/ })).toBeVisible();
    await expectStatus(page, "saved"); // recién cargado: nada pendiente

    // Seguir editando sobre lo cargado: se guarda con la revisión correcta.
    await entities.getByRole("button", { name: /Ana Persistente/ }).click();
    await rename(page, "Ana Renombrada");
    await expectStatus(page, "saved");
    expect((await serverContent(page, id)).nodes.map((n) => n.label).sort()).toEqual(["Ana Renombrada", "Línea de Ana"]);

    // Eliminar también se persiste (y arrastra sus relaciones).
    await entities.getByRole("button", { name: /Línea de Ana/ }).click();
    await page.keyboard.press("Delete");
    await expectStatus(page, "saved");
    const after = await serverContent(page, id);
    expect(after.nodes.map((n) => n.label)).toEqual(["Ana Renombrada"]);
    expect(after.edges).toHaveLength(0);
  });

  test("sin cambios no se envía nada al servidor", async ({ page }) => {
    const puts: string[] = [];
    page.on("request", (r) => r.method() === "PUT" && puts.push(r.url()));
    await openEditor(page, "sv2");
    await page.waitForTimeout(4000);
    expect(puts).toEqual([]);
    await addEntity(page, "Persona");
    await expectStatus(page, "saved");
    expect(puts).toHaveLength(1);
    await page.waitForTimeout(3000);
    expect(puts).toHaveLength(1); // guardado y en reposo: no vuelve a enviar
  });

  test("al volver atrás se guarda lo pendiente sin esperar al retardo", async ({ page }) => {
    const id = await openEditor(page, "sv3");
    await addEntity(page, "Persona");
    await rename(page, "Guardada al salir");
    await page.getByRole("link", { name: /Volver/ }).click(); // inmediatamente, antes de que venza el retardo
    await expect(page).toHaveURL(new RegExp(`/graphs/${id}$`));
    await expect.poll(async () => (await serverContent(page, id)).nodes.map((n) => n.label), { timeout: 10_000 }).toEqual(["Guardada al salir"]);
  });

  test("sin conexión: avisa, reintenta solo y acaba guardando sin perder nada", async ({ page }) => {
    const id = await openEditor(page, "sv4");
    let failures = 0;
    await page.route("**/api/v1/graphs/*/content", (route) => {
      if (route.request().method() === "PUT" && failures < 2) {
        failures++;
        return route.abort("failed");
      }
      return route.continue();
    });
    await addEntity(page, "Persona");
    await rename(page, "Resistente");
    await expectStatus(page, "offline");
    await expect(page.getByText("Sin conexión, reintentando…")).toBeVisible();
    await expectStatus(page, "saved"); // reintentos a 3 s y 6 s
    expect(failures).toBe(2);
    expect((await serverContent(page, id)).nodes.map((n) => n.label)).toEqual(["Resistente"]);
  });

  test("un error del servidor se muestra, no se reintenta solo y «Reintentar» lo vuelve a intentar", async ({ page }) => {
    const id = await openEditor(page, "sv5");
    let calls = 0;
    await page.route("**/api/v1/graphs/*/content", (route) => {
      if (route.request().method() === "PUT" && calls++ === 0) {
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ statusCode: 400, code: "VALIDATION_ERROR", message: "El contenido del grafo no es válido.", requestId: "x" }) });
      }
      return route.continue();
    });
    await addEntity(page, "Persona");
    await expectStatus(page, "error");
    await page.waitForTimeout(5000);
    expect(calls).toBe(1); // no se reintenta solo
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expectStatus(page, "saved");
    expect((await serverContent(page, id)).nodes).toHaveLength(1);
  });
});

test.describe("editor: conflicto entre dos ventanas", () => {
  async function twoWindows(page: Page, tag: string) {
    const id = await openEditor(page, tag);
    const other = await page.context().newPage(); // misma sesión: otra pestaña del mismo usuario
    await other.goto(`/graphs/${id}/editor`);
    await expect(other.getByRole("heading", { name: "Grafo de prueba", level: 1 })).toBeVisible();
    return { id, other };
  }

  test("la segunda ventana en guardar recibe el aviso y NO pisa lo guardado; se puede cargar la versión del servidor", async ({ page }) => {
    const { id, other } = await twoWindows(page, "cf1");

    await addEntity(other, "Persona");
    await rename(other, "De la ventana B");
    await expectStatus(other, "saved");

    await addEntity(page, "Vehículo");
    await rename(page, "De la ventana A");
    await expectStatus(page, "conflict");
    const dialog = page.getByRole("dialog", { name: "Este grafo se modificó en otro lugar" });
    await expect(dialog).toBeVisible();
    // Lo guardado por B sigue intacto: A no lo pisó.
    expect((await serverContent(page, id)).nodes.map((n) => n.label)).toEqual(["De la ventana B"]);

    // Seguir editando sin guardar no envía nada.
    await dialog.getByRole("button", { name: "Seguir sin guardar" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(3000);
    await expectStatus(page, "conflict");
    expect((await serverContent(page, id)).nodes.map((n) => n.label)).toEqual(["De la ventana B"]);

    // Reabrir desde la cabecera y cargar la versión del servidor.
    await page.getByRole("button", { name: "Resolver" }).click();
    await dialog.getByRole("button", { name: "Cargar la del servidor" }).click();
    await expect(dialog).toBeHidden();
    await expectStatus(page, "saved");
    const entities = page.getByRole("list", { name: "Entidades" });
    await expect(entities.getByRole("button", { name: /De la ventana B/ })).toBeVisible();
    await expect(entities.getByRole("button", { name: /De la ventana A/ })).toHaveCount(0);

    // Y se puede seguir editando con normalidad desde la nueva revisión.
    await addEntity(page, "Persona");
    await rename(page, "Tras resolver");
    await expectStatus(page, "saved");
    expect((await serverContent(page, id)).nodes.map((n) => n.label).sort()).toEqual(["De la ventana B", "Tras resolver"]);
  });

  test("sobrescribir con mi versión sustituye lo guardado por el contenido de esta ventana", async ({ page }) => {
    const { id, other } = await twoWindows(page, "cf2");
    await addEntity(other, "Persona");
    await rename(other, "De la ventana B");
    await expectStatus(other, "saved");

    await addEntity(page, "Vehículo");
    await rename(page, "De la ventana A");
    await expectStatus(page, "conflict");
    await page.getByRole("dialog").getByRole("button", { name: "Sobrescribir con mi versión" }).click();
    await expectStatus(page, "saved");
    // El cambio de nombre puede guardarse en un segundo envío (la entidad se guarda al crearla y otra vez al renombrarla).
    await expect.poll(async () => (await serverContent(page, id)).nodes.map((n) => n.label)).toEqual(["De la ventana A"]);
  });

  test("tras un conflicto la otra ventana también recibe el aviso al editar de nuevo (revisión desfasada)", async ({ page }) => {
    const { other } = await twoWindows(page, "cf3");
    await addEntity(page, "Persona");
    await expectStatus(page, "saved");
    await addEntity(other, "Vehículo");
    await expectStatus(other, "conflict");
    await expect(other.getByRole("dialog", { name: "Este grafo se modificó en otro lugar" })).toBeVisible();
  });
});

test.describe("editor: móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("en 390 px no hay desbordamiento y los tres paneles se alternan con pestañas", async ({ page }) => {
    await openEditor(page, "edm");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    // Arranca en el lienzo; la paleta está en «Entidades».
    await page.getByRole("tab", { name: "Entidades", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Persona.*añadir/ })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await addEntity(page, "Persona");

    // Al añadir, salta a «Detalles» para editar la nueva entidad.
    await expect(page.getByLabel("Nombre en el grafo")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.getByRole("tab", { name: "Lienzo", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Herramientas del editor" })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test.describe("editor: seguridad", () => {
  test("otra cuenta no puede abrir el editor de un grafo ajeno ni uno inexistente", async ({ browser }) => {
    const a = await (await browser.newContext()).newPage();
    await registerViaApi(a, "edA");
    const id = await createGraphViaApi(a, "Grafo privado de A");

    const b = await (await browser.newContext()).newPage();
    await registerViaApi(b, "edB");
    await b.goto(`/graphs/${id}/editor`);
    await expect(b.getByText("No encontramos lo que buscas")).toBeVisible();
    await expect(b.getByText("Grafo privado de A")).toHaveCount(0);
    const ajeno = await b.locator("body").innerText();

    await b.goto("/graphs/3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c/editor");
    await expect(b.getByText("No encontramos lo que buscas")).toBeVisible();
    expect(await b.locator("body").innerText()).toBe(ajeno);
  });

  test("sin sesión se redirige al inicio de sesión", async ({ page }) => {
    await page.goto("/graphs/3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c/editor");
    await expect(page).toHaveURL(/\/login/);
  });

  test("un grafo en la papelera no se puede editar", async ({ page }) => {
    const id = await openEditor(page, "ed6", "Grafo a la papelera");
    const res = await page.request.delete(`/api/v1/graphs/${id}`, { headers: { Origin: "http://127.0.0.1:5273" } });
    expect(res.ok()).toBe(true);
    await page.goto(`/graphs/${id}/editor`);
    await expect(page.getByText("Este grafo está en la papelera")).toBeVisible();
    await expect(page.getByRole("list", { name: "Entidades" })).toHaveCount(0);
  });
});

// ------------------------------------------------------------------------------------------------
// Lienzo ZoomCharts: requiere licencia real.
// ------------------------------------------------------------------------------------------------
const HAS_LICENSE = !!process.env.ZOOMCHARTS_LICENSE && !!process.env.ZOOMCHARTS_LICENSE_KEY;

test.describe("editor: lienzo de ZoomCharts", () => {
  test.skip(!HAS_LICENSE, "Define ZOOMCHARTS_LICENSE y ZOOMCHARTS_LICENSE_KEY en .env para ejecutar las pruebas del lienzo.");

  test("el lienzo se monta, pinta los 10 tipos de forma y la selección se sincroniza", async ({ page }, testInfo) => {
    await openEditor(page, "zc1");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    for (const t of ["Persona", "Bien inmueble", "Vehículo", "Teléfono", "Red social", "Organización", "Cuenta bancaria", "Documento", "Ubicación", "Otro"]) {
      await addEntity(page, t);
    }
    await expect(page.locator("canvas").first()).toBeVisible();

    // Tres relaciones con certeza y dirección distintas, para revisar trazo y flechas.
    const relate = async (from: string, to: string, evidence: string, direction: string) => {
      await page.getByRole("button", { name: "Nueva relación…" }).first().click();
      const d = page.getByRole("dialog", { name: "Nueva relación" });
      await d.getByLabel("Origen").selectOption({ label: `${from} (${from})` });
      await d.getByLabel("Destino").selectOption({ label: `${to} (${to})` });
      await d.getByLabel("Naturaleza del dato").selectOption(evidence);
      await d.getByLabel("Dirección").selectOption(direction);
      await d.getByRole("button", { name: "Crear relación" }).click();
      await expect(d).toBeHidden();
    };
    await relate("Persona", "Vehículo", "hypothesis", "forward");
    await relate("Persona", "Teléfono", "recorded", "both");
    await relate("Persona", "Documento", "observation", "none");
    await page.getByRole("tab", { name: /Entidades/ }).click();
    await page.getByRole("list", { name: "Entidades" }).getByRole("button", { name: /Organización/ }).click(); // aro de selección
    await page.waitForTimeout(2500); // deja que termine la distribución automática
    await page.getByRole("button", { name: "Ajustar a la vista" }).click();
    await page.waitForTimeout(1200);
    // Captura adjunta para revisar a ojo triángulo, hexágono, rombo, marcador, etc.
    const shot = await page.getByTestId("net-chart").screenshot({ path: "test-results/formas-del-lienzo.png" });
    await testInfo.attach("formas-del-lienzo", { body: shot, contentType: "image/png" });

    // Selección desde la lista → el panel de detalles la refleja.
    await page.getByRole("list", { name: "Entidades" }).getByRole("button", { name: /Persona/ }).click();
    await expect(page.getByRole("heading", { name: "Persona", level: 2 })).toBeVisible();
  });

  test("montajes y desmontajes repetidos no acumulan lienzos ni listeners", async ({ page }) => {
    const id = await openEditor(page, "zc2");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    for (let i = 0; i < 5; i++) {
      await page.getByRole("link", { name: /Volver/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Grafo de prueba" })).toBeVisible();
      await page.goto(`/graphs/${id}/editor`, { waitUntil: "commit" });
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
      // Navegación interna (sin recargar): no debe quedar más de un lienzo.
      await page.getByRole("link", { name: /Volver/ }).click();
      await page.getByRole("link", { name: "Abrir editor" }).click();
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
      expect(await page.locator("[data-testid=net-chart]").count()).toBe(1);
    }
  });

  test("solo se contacta con el servicio de licencias de ZoomCharts y nunca se envían datos del grafo", async ({ page }) => {
    const external: Array<{ method: string; url: string; body: string | null }> = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.origin !== "http://127.0.0.1:5273") external.push({ method: r.method(), url: r.url(), body: r.postData() });
    });
    await openEditor(page, "zc3", "Grafo secreto confidencial");
    await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready");
    await addEntity(page, "Persona");
    await page.getByLabel("Nombre en el grafo").fill("Nombre-Secreto-Zeta");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await page.waitForTimeout(1500);

    const hosts = new Set(external.map((r) => new URL(r.url).host));
    expect([...hosts].filter((h) => h !== "api.zoomcharts-cloud.com")).toEqual([]);
    for (const r of external) {
      expect(r.body ?? "").not.toContain("Nombre-Secreto-Zeta");
      expect(r.body ?? "").not.toContain("Grafo secreto confidencial");
      expect(r.url).not.toContain("Secreto");
    }
  });

  // Cada forma tiene su propio `hitTest`/`distanceToEdge`. Con una entidad fijada en el origen, el lienzo la
  // centra: un clic en el centro debe seleccionarla y un arrastre debe moverla y GUARDAR la nueva posición.
  const SHAPE_TYPES: Array<[string, string]> = [
    ["person", "Persona"],
    ["property", "Bien inmueble"],
    ["vehicle", "Vehículo"],
    ["phone", "Teléfono"],
    ["social", "Red social"],
    ["organization", "Organización o empresa"],
    ["bank_account", "Cuenta bancaria"],
    ["document", "Documento"],
    ["location", "Ubicación"],
    ["other", "Otro"],
  ];

  test("clic y arrastre funcionan sobre cada una de las 10 formas y la nueva posición se guarda", async ({ page }) => {
    test.setTimeout(180_000);
    await registerViaApi(page, "zc4");
    for (const [type, label] of SHAPE_TYPES) {
      const id = await createGraphViaApi(page, `Forma ${type}`);
      const node = { id: crypto.randomUUID(), type, label: `Nodo ${label}`, description: "", notes: "", tags: [], metadata: {}, positionX: 0, positionY: 0 };
      const put = await api(page.request, "PUT", `/graphs/${id}/content`, { expectedRevision: 1, nodes: [node], edges: [] });
      expect(put.status(), `${type}: ${await put.text()}`).toBe(200);

      await page.goto(`/graphs/${id}/editor`);
      const chart = page.getByTestId("net-chart");
      await expect(chart).toHaveAttribute("data-status", "ready");
      await page.waitForTimeout(800); // deja que termine el encuadre
      const box = (await chart.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Clic en el centro → seleccionada (el panel de detalles muestra su nombre).
      await page.mouse.click(cx, cy);
      await expect(page.getByRole("heading", { name: `Nodo ${label}`, level: 2 }, ), `${type}: clic`).toBeVisible();

      // Arrastre: la posición cambia y se persiste.
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 40, cy + 20, { steps: 5 });
      await page.mouse.move(cx + 90, cy + 50, { steps: 5 });
      await page.mouse.up();
      await expect(saveStatus(page), `${type}: arrastre`).toHaveAttribute("data-save-status", "saved", { timeout: 15_000 });
      const res = await page.request.get(`/api/v1/graphs/${id}/content`);
      const saved = ((await res.json()) as { nodes: Array<{ positionX: number; positionY: number }> }).nodes[0]!;
      expect(Math.hypot(saved.positionX, saved.positionY), `${type}: posición guardada`).toBeGreaterThan(5);
    }
  });
});
