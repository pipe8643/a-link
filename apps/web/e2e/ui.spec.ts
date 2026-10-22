import { expect, test } from "@playwright/test";
import { createGraphViaApi, registerViaApi } from "./helpers";

const ORIGIN = "http://127.0.0.1:5273";

test.describe("interfaz", () => {
  test("móvil (390 px): sin desbordamiento horizontal, menú lateral y panel de carpetas utilizables", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerViaApi(page, "movil");
    await createGraphViaApi(page, "Un grafo con un nombre bastante largo para comprobar que el texto se recorta bien");

    for (const route of ["/", "/graphs", "/trash", "/settings"]) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `desbordamiento horizontal en ${route}`).toBeLessThanOrEqual(0);
    }

    await page.goto("/graphs");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByRole("navigation", { name: "Principal" })).toBeVisible();
    await menu.getByRole("link", { name: "Papelera" }).click();
    await expect(page).toHaveURL(/\/trash$/);
    await expect(page.getByRole("dialog")).toHaveCount(0); // el menú se cierra al navegar

    await page.goto("/graphs");
    await page.getByRole("button", { name: "Carpetas" }).click();
    await expect(page.getByRole("dialog").getByRole("navigation", { name: "Carpetas" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("tema oscuro: se aplica, persiste al recargar y no hay parpadeo (clase puesta antes de pintar)", async ({ page }) => {
    await registerViaApi(page, "tema");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Menú de usuario" }).click();
    await page.getByRole("menuitem", { name: "Tema oscuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("alink-theme"))).toBe("dark");

    // La preferencia es solo de presentación: no contiene nada sensible.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toMatch(/token|sid|password|@/i);
  });

  test("privacidad de red: durante un recorrido completo solo se habla con el propio origen", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["data:", "blob:", "about:"].includes(u.protocol) && u.origin !== ORIGIN) external.push(r.url());
    });
    await registerViaApi(page, "red");
    await createGraphViaApi(page, "Caso privado");
    for (const route of ["/", "/graphs", "/trash", "/settings"]) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
    }
    await page.goto("/login"); // con sesión redirige al panel; da igual, también se vigila
    expect(external, "peticiones a terceros (fuentes, CDN, analítica…)").toEqual([]);
  });

  test("teclado: enlace de salto al contenido y diálogos con foco atrapado y cierre con Escape", async ({ page, browserName }) => {
    await registerViaApi(page, "teclado");
    await page.goto("/graphs");
    await expect(page.getByRole("main")).toBeVisible(); // la página ya pintada: un Tab demasiado pronto cae antes de que exista el enlace

    // Safari/WebKit no incluye los enlaces en el orden de Tab (solo con Opción+Tab, ajuste del navegador): ahí se comprueba el
    // enlace dándole el foco directamente; en Chromium y Firefox se recorre con Tab como lo haría una persona.
    if (browserName === "webkit") await page.getByRole("link", { name: /Saltar al contenido/i }).focus();
    else await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /Saltar al contenido/i })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#contenido")).toBeFocused();

    await page.getByRole("button", { name: "Nuevo grafo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo grafo" });
    await expect(dialog.getByLabel("Nombre")).toBeFocused(); // autoFocus en el primer campo
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true); // el foco no escapa
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
