import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, createGraphViaApi, registerViaApi } from "./helpers";

/**
 * Exploración del grafo: filtros cruzados, enfoque con expandir/contraer, halos y exportación de lo visible.
 * Todo con datos sintéticos. La primera parte no necesita licencia de ZoomCharts (trabaja con los paneles); la
 * segunda usa el lienzo real y se omite de forma explícita sin licencia.
 */
const HAS_LICENSE = !!process.env.ZOOMCHARTS_LICENSE && !!process.env.ZOOMCHARTS_LICENSE_KEY;

const base = { description: "", notes: "", metadata: {} };
/** Los identificadores son únicos en toda la base de datos: cada prueba necesita los suyos. */
function buildGraph() {
  const ids = { centro: crypto.randomUUID(), ana: crypto.randomUUID(), beto: crypto.randomUUID(), tel: crypto.randomUUID(), casa: crypto.randomUUID(), lejano: crypto.randomUUID() };
  const nodes = [
    { id: ids.centro, type: "person", label: "Centro", tags: [], positionX: 0, positionY: 0, ...base },
    { id: ids.ana, type: "person", label: "Ana", tags: ["Norte"], positionX: -300, positionY: -150, ...base },
    { id: ids.beto, type: "person", label: "Beto", tags: ["Sur"], positionX: 300, positionY: -150, ...base },
    { id: ids.tel, type: "phone", label: "Tel 555", tags: [], positionX: -300, positionY: 150, ...base },
    { id: ids.casa, type: "property", label: "Casa", tags: [], positionX: 300, positionY: 0, ...base },
    { id: ids.lejano, type: "person", label: "Lejano", tags: ["Sur"], positionX: 600, positionY: -300, ...base },
  ];
  const edge = (a: string, b: string, metadata: Record<string, unknown>) => ({ id: crypto.randomUUID(), sourceId: a, targetId: b, relationshipType: "contact", label: "", metadata: { direction: "forward", ...metadata } });
  const edges = [
    edge(ids.centro, ids.ana, { evidenceClass: "recorded", startDate: "2019-03-01", endDate: "2019-12-31" }),
    edge(ids.centro, ids.beto, { evidenceClass: "hypothesis" }),
    edge(ids.centro, ids.tel, { evidenceClass: "observation", startDate: "2022-01-01" }),
    edge(ids.centro, ids.casa, { evidenceClass: "recorded" }),
    edge(ids.beto, ids.lejano, { evidenceClass: "recorded" }),
  ];
  return { nodes, edges };
}

async function seed(page: Page, tag: string) {
  await registerViaApi(page, tag);
  const id = await createGraphViaApi(page, "Grafo de exploración");
  const { nodes, edges } = buildGraph();
  const put = await api(page.request, "PUT", `/graphs/${id}/content`, { expectedRevision: 1, nodes, edges });
  expect(put.status(), await put.text()).toBe(200);
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name: "Grafo de exploración", level: 1 })).toBeVisible();
  return id;
}

const openFilters = async (page: Page) => {
  await page.getByText("Vista y filtros").click();
  await expect(page.getByRole("checkbox", { name: /Persona/ })).toBeVisible();
};
const list = (page: Page) => page.getByRole("list", { name: "Entidades" });
const pick = (page: Page, label: string) => list(page).getByRole("button", { name: new RegExp(label) }).click();
const summary = (page: Page, text: string | RegExp) => expect(page.getByText(text)).toBeVisible();
const savedContent = async (page: Page, id: string) => (await (await page.request.get(`/api/v1/graphs/${id}/content`)).json()) as { nodes: Array<{ id: string; label: string }>; edges: unknown[] };

test.describe("exploración: filtros y enfoque desde los paneles", () => {
  test("filtrar por tipo oculta en la vista, lo marca en la lista y «Mostrar todo» lo devuelve", async ({ page }) => {
    await seed(page, "xp1");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Teléfono/ }).uncheck();
    await summary(page, "Filtrado: 5 de 6 entidades · 4 de 5 relaciones");
    await expect(list(page).getByRole("button", { name: /Tel 555/ })).toContainText("Oculta");
    await expect(list(page).getByRole("button", { name: /Casa/ })).not.toContainText("Oculta");
    await page.getByRole("button", { name: "Mostrar todo" }).first().click();
    await expect(page.getByText(/Filtrado:/)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Teléfono/ })).toBeChecked();
    await expect(list(page).getByRole("button", { name: /Tel 555/ })).not.toContainText("Oculta");
  });

  test("lo que se oculta sigue en el documento: editar con filtros activos no pierde nada al guardar", async ({ page }) => {
    const id = await seed(page, "xp2");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Teléfono/ }).uncheck();
    await page.getByRole("checkbox", { name: /Bien inmueble/ }).uncheck();
    await summary(page, "Filtrado: 4 de 6 entidades");

    // Se renombra una entidad visible: el autoguardado envía el grafo COMPLETO.
    await pick(page, "Ana");
    await page.getByLabel("Nombre en el grafo").fill("Ana María");
    await page.getByRole("button", { name: "Aplicar cambios" }).click();
    await expect(page.locator("[data-save-status]")).toHaveAttribute("data-save-status", "saved", { timeout: 15_000 });
    const saved = await savedContent(page, id);
    expect(saved.nodes.map((n) => n.label).sort()).toEqual(["Ana María", "Beto", "Casa", "Centro", "Lejano", "Tel 555"]);
    expect(saved.edges).toHaveLength(5);
  });

  test("una entidad nueva de un tipo oculto aparece: su tipo vuelve a marcarse", async ({ page }) => {
    const id = await seed(page, "xp3");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Teléfono/ }).uncheck();
    await page.getByRole("button", { name: /^Teléfono.*añadir/ }).click();
    await expect(page.getByRole("checkbox", { name: /Teléfono/ })).toBeChecked();
    await expect(page.getByText(/Filtrado:/)).toHaveCount(0);
    await expect(page.locator("[data-save-status]")).toHaveAttribute("data-save-status", "saved", { timeout: 15_000 });
    expect((await savedContent(page, id)).nodes).toHaveLength(7);
  });

  test("enfocar, expandir y contraer vecinos desde el panel de detalles", async ({ page }) => {
    await seed(page, "xp4");
    await pick(page, "Beto");
    await page.getByRole("button", { name: "Enfocar aquí" }).click();
    await summary(page, "Enfocado: 3 de 6 entidades · 2 de 5 relaciones"); // Beto, Centro y Lejano

    await pick(page, "Centro");
    await page.getByRole("button", { name: "Expandir vecinos (3)" }).click(); // Ana, Tel 555 y Casa
    await summary(page, "Enfocado: 6 de 6 entidades · 5 de 5 relaciones");
    await expect(page.getByRole("button", { name: "Expandir vecinos" })).toHaveCount(0);

    await page.getByRole("button", { name: "Contraer vecinos" }).click();
    await summary(page, "Enfocado: 3 de 6 entidades");
    await page.getByRole("button", { name: "Mostrar todo" }).first().click();
    await expect(page.getByText(/Enfocado:/)).toHaveCount(0);
  });

  test("la selección se mantiene visible aunque el filtro la ocultaría, y la lista de relaciones avisa de las ocultas", async ({ page }) => {
    await seed(page, "xp5");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Teléfono/ }).uncheck();
    await summary(page, "Filtrado: 5 de 6 entidades");
    await pick(page, "Centro");
    await expect(page.getByRole("button", { name: /Tel 555 \(oculta\)/ })).toBeVisible();
    await pick(page, "Tel 555"); // seleccionarla la muestra (4 → 6 entidades visibles)
    await summary(page, "Filtrado: 6 de 6 entidades");
  });

  test("fechas: el rango filtra relaciones, no entidades; «incluir sin fecha» y los rangos al revés se explican", async ({ page }) => {
    await seed(page, "xp6");
    await openFilters(page);
    await page.getByLabel("Hasta").fill("2018-12-31");
    await summary(page, "Filtrado: 6 de 6 entidades · 3 de 5 relaciones"); // fuera: la de 2019 y la de 2022 en adelante
    await page.getByLabel("Incluir relaciones sin fecha").uncheck();
    await summary(page, "Filtrado: 6 de 6 entidades · 0 de 5 relaciones");
    await page.getByLabel("Incluir relaciones sin fecha").check();
    await page.getByLabel("Hasta").fill("2019-06-30");
    await page.getByLabel("Desde").fill("2019-01-01");
    await summary(page, "· 4 de 5 relaciones"); // 2019 y las tres sin fecha; la de 2022 no
    await page.getByRole("button", { name: /Quitar filtros/ }).click();
    await expect(page.getByText(/Filtrado:/)).toHaveCount(0);
  });

  test("naturaleza del dato: desmarcar «Hipótesis» quita esas relaciones", async ({ page }) => {
    await seed(page, "xp7");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Hipótesis/ }).uncheck();
    await summary(page, "· 4 de 5 relaciones");
  });

  test("exportar solo lo visible lo indica en el documento; «todo el grafo» no", async ({ page }) => {
    await seed(page, "xp8");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Teléfono/ }).uncheck();
    await page.getByRole("checkbox", { name: /Bien inmueble/ }).uncheck();

    const JSZip = (await import("jszip")).default;
    const exportEditable = async (scope: "visible" | "all") => {
      await page.getByRole("button", { name: /^Exportar/ }).first().click();
      const dialog = page.getByRole("dialog", { name: "Exportar grafo" });
      await dialog.getByLabel("Qué exportar").selectOption(scope);
      await dialog.getByLabel("Formato").selectOption("pptx-editable");
      const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
      await expect(dialog).toBeHidden();
      return (await (await JSZip.loadAsync(readFileSync(await download.path()))).file("ppt/slides/slide1.xml")!.async("string")) as string;
    };

    const visible = await exportEditable("visible");
    expect(visible).toContain("Vista filtrada: 4 de 6 entidades");
    expect(visible).toContain("Centro");
    expect(visible).not.toContain("Tel 555");
    expect(visible).not.toContain(">Casa<");

    const all = await exportEditable("all");
    expect(all).not.toContain("Vista filtrada");
    expect(all).toContain("Tel 555");
    expect(all).toContain("Casa");
  });

  test("móvil: los filtros caben en la pantalla, se manejan con el teclado y no desbordan", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seed(page, "xp9");
    await page.getByRole("tab", { name: "Entidades" }).click();
    await openFilters(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = page.getByRole("checkbox", { name: /Teléfono/ });
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).not.toBeChecked();
    await page.getByRole("tab", { name: "Lienzo" }).click();
    await summary(page, "Filtrado: 5 de 6 entidades");
  });
});

// ------------------------------------------------------------------------------------------------
async function inkPixels(page: Page, bytes: Buffer) {
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
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) ink++;
    return ink;
  }, bytes.toString("base64"));
}

/**
 * Mide cuántos píxeles distintos hay entre dos capturas (en el navegador, sin librerías de imagen). Con `shift` se
 * admite que todo el lienzo se haya desplazado hasta ese número de píxeles (el diseño de la página puede variar 1 px).
 */
async function diffPixels(page: Page, a: Buffer, b: Buffer, shift = 0) {
  return page.evaluate(
    async ({ a, b, shift }) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return -1;
      const { width, height } = x;
      let best = Infinity;
      for (let dy = -shift; dy <= shift; dy++) {
        for (let dx = -shift; dx <= shift; dx++) {
          let diff = 0;
          for (let py = shift; py < height - shift; py++) {
            for (let px = shift; px < width - shift; px++) {
              const i = (py * width + px) * 4;
              const j = ((py + dy) * width + (px + dx)) * 4;
              if (Math.abs(x.data[i]! - y.data[j]!) + Math.abs(x.data[i + 1]! - y.data[j + 1]!) + Math.abs(x.data[i + 2]! - y.data[j + 2]!) > 60) diff++;
            }
          }
          best = Math.min(best, diff);
        }
      }
      return best;
    },
    { a: a.toString("base64"), b: b.toString("base64"), shift },
  );
}

test.describe("exploración: lienzo de ZoomCharts", () => {
  test.skip(!HAS_LICENSE, "Define ZOOMCHARTS_LICENSE y ZOOMCHARTS_LICENSE_KEY en .env para ejecutar estas pruebas.");
  test.setTimeout(180_000);

  const ready = async (page: Page) => {
    const chart = page.getByTestId("net-chart");
    await expect(chart).toHaveAttribute("data-status", "ready");
    // El lienzo anima su encuadre inicial; el tiempo que tarda varía según el navegador y la carga de la máquina. Se espera a
    // que dos capturas separadas medio segundo sean idénticas en lugar de adivinar una pausa fija.
    let previous = await chart.screenshot();
    let still = 0;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      const current = await chart.screenshot();
      still = (await diffPixels(page, previous, current)) === 0 ? still + 1 : 0;
      if (still >= 3) return; // 1,5 s sin cambios
      previous = current;
    }
    throw new Error("El lienzo no se estabilizó en 10 s");
  };

  test("pasar el ratón por el lienzo no desplaza el grafo (con y sin halos activados antes)", async ({ page }) => {
    await seed(page, "xz0");
    await ready(page);
    const chart = page.getByTestId("net-chart");
    const before = await chart.screenshot();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 120);
    await page.mouse.move(box.x + 140, box.y + 180, { steps: 4 });
    await page.waitForTimeout(800);
    expect(await diffPixels(page, before, await chart.screenshot())).toBeLessThan(60);

    // Tras activar y desactivar los halos el lienzo sigue sin moverse.
    await openFilters(page);
    await page.getByLabel("Halos", { exact: true }).selectOption("type");
    await page.waitForTimeout(500);
    await page.getByLabel("Halos", { exact: true }).selectOption("none");
    await page.waitForTimeout(800);
    const again = await chart.screenshot();
    await page.mouse.move(box.x + 300, box.y + 120);
    await page.mouse.move(box.x + 340, box.y + 180, { steps: 4 });
    await page.waitForTimeout(800);
    expect(await diffPixels(page, again, await chart.screenshot())).toBeLessThan(60);
  });
  test("los halos cambian lo que se dibuja y se pueden quitar", async ({ page }) => {
    await seed(page, "xz1");
    await ready(page);
    const chart = page.getByTestId("net-chart");
    const none = await chart.screenshot();
    await openFilters(page);
    await page.getByLabel("Halos", { exact: true }).selectOption("type");
    await page.waitForTimeout(800);
    const typed = await chart.screenshot();
    expect(await diffPixels(page, none, typed)).toBeGreaterThan(500);

    await page.getByLabel("Halos", { exact: true }).selectOption("tag");
    await page.waitForTimeout(800);
    const tagged = await chart.screenshot();
    expect(await diffPixels(page, typed, tagged)).toBeGreaterThan(200);

    await page.getByLabel("Halos", { exact: true }).selectOption("none");
    await page.waitForTimeout(800);
    const again = await chart.screenshot();
    expect(await diffPixels(page, none, again, 1)).toBeLessThan(80); // vuelve a lo de antes (salvo parpadeos de animación)
  });

  test("ocultar y volver a mostrar un tipo deja el grafo donde estaba", async ({ page }) => {
    await seed(page, "xz2");
    await ready(page);
    const chart = page.getByTestId("net-chart");
    const before = await chart.screenshot();
    await openFilters(page);
    await page.getByRole("checkbox", { name: /Bien inmueble/ }).uncheck();
    await page.waitForTimeout(800);
    const hidden = await chart.screenshot();
    expect(await diffPixels(page, before, hidden)).toBeGreaterThan(200); // la entidad ya no se ve
    await page.getByRole("checkbox", { name: /Bien inmueble/ }).check();
    await page.waitForTimeout(2000);
    const after = await chart.screenshot();
    expect(await diffPixels(page, before, after, 1)).toBeLessThan(150); // igual salvo, como mucho, 1 px de desplazamiento de todo el lienzo
  });

  // PENDIENTE (no verificado en E2E): con ZoomCharts bajo Playwright el primer clic sobre una entidad reencuadra la vista y el
  // segundo clic del doble clic ya no cae sobre el nodo (ZoomCharts entrega `onDoubleClick` sin `clickNode`; `onClick` ni se emite).
  // La lógica (enfocar/expandir/contraer, toast y llamada desde el lienzo) sí está cubierta por pruebas unitarias con un lienzo falso.
  // Hay que comprobarlo a mano con un ratón real; ver docs/03-plan-implementacion.md (Fase 6b, pendientes).
  test.fixme("doble clic en una entidad del lienzo expande y contrae sus vecinos", async ({ page }) => {
    await seed(page, "xz3");
    await ready(page);
    // Se enfoca en «Casa» (solo tiene un vecino: Centro): quedan dos entidades unidas por una línea, centradas.
    await pick(page, "Casa");
    await page.getByRole("button", { name: "Enfocar aquí" }).click();
    await summary(page, "Enfocado: 2 de 6 entidades");
    await page.getByRole("button", { name: "Ajustar a la vista" }).click();
    await page.waitForTimeout(1500);

    // Se deselecciona (clic en el fondo) para que la selección no fije nada en la vista.
    const chart = page.getByTestId("net-chart");
    await chart.click({ position: { x: 6, y: 150 } });
    await page.waitForTimeout(1500); // la primera interacción reencuadra la vista: se mide cuando ya se ha asentado
    const png = await chart.screenshot();
    const box = (await chart.boundingBox())!;
    // «Centro» (x=0) y «Casa» (x=300) están en la misma fila horizontal; la línea que las une también.
    const row = await page.evaluate(
      async ({ b64 }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        const at = (x: number, y: number) => (y * c.width + x) * 4;
        const bg = [data[at(2, c.height - 60)]!, data[at(2, c.height - 60) + 1]!, data[at(2, c.height - 60) + 2]!];
        const isInk = (x: number, y: number) => {
          if (y < 70) return false; // barra de estado de la vista
          if (x > c.width * 0.8 && y > c.height * 0.85) return false; // logotipo de la licencia de desarrollo
          const i = at(x, y);
          return Math.abs(data[i]! - bg[0]!) + Math.abs(data[i + 1]! - bg[1]!) + Math.abs(data[i + 2]! - bg[2]!) > 80;
        };
        // Las dos entidades están en la misma fila: se busca su caja y se toma la fila central.
        let minY = -1;
        let maxY = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (isInk(x, y)) { if (minY < 0) minY = y; maxY = y; break; }
        if (minY < 0) return { min: -1, max: -1, y: -1 };
        const y = Math.round((minY + maxY) / 2) - 10; // las etiquetas bajo cada forma alargan la caja por abajo
        let min = -1;
        let max = -1;
        for (let x = 0; x < c.width; x++) if (isInk(x, y)) { if (min < 0) min = x; max = x; }
        return { min, max, y };
      },
      { b64: png.toString("base64") },
    );
    expect(row.min).toBeGreaterThanOrEqual(0);
    // ZoomCharts necesita ver el puntero sobre el nodo antes de pulsar: se mueve y se espera un instante.
    const dbl = async (px: number, py: number) => {
      await page.mouse.move(px - 20, py);
      await page.mouse.move(px, py);
      await page.waitForTimeout(300);
      await page.mouse.dblclick(px, py);
    };
    const y = box.y + row.y;

    // Doble clic sobre «Centro» (a la izquierda): tiene vecinos ocultos → se expanden. (El contraer y el caso sin vecinos ocultos
    // se verifican en las pruebas unitarias del lienzo y del hook: tras cada interacción ZoomCharts puede reencuadrar la vista.)
    await dbl(box.x + row.min + 10, y);
    await summary(page, "Enfocado: 5 de 6 entidades"); // Casa, Centro, Ana, Beto y Tel 555 (Lejano sigue oculto)
    await expect(page.getByText("Vecinos mostrados")).toBeVisible();
  });
});
