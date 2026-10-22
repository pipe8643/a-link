import { expect, test } from "@playwright/test";
import { PASSWORD, createGraphViaApi, loginViaUi, logoutViaUi, uniqueEmail } from "./helpers";

/**
 * Recorrido completo de una persona (criterios 1, 6, 7 y 8): alta por la interfaz → crear un grafo → editarlo →
 * esperar el guardado → cerrar sesión → volver a entrar → recuperar el trabajo → refrescar. Todo desde la interfaz
 * salvo la creación del grafo (cubierta por library.spec.ts) y sin lienzo, de modo que corre en cualquier navegador.
 */
test("alta → editar → guardar → cerrar sesión → volver a entrar → el trabajo sigue ahí (y tras refrescar)", async ({ page }) => {
  const email = uniqueEmail("viaje");
  await page.goto("/register");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/$/);

  const id = await createGraphViaApi(page, "Caso de viaje");
  await page.goto(`/graphs/${id}/editor`);
  await expect(page.getByRole("heading", { name: "Caso de viaje", level: 1 })).toBeVisible();

  const entities = page.getByRole("list", { name: "Entidades" });
  await page.getByRole("button", { name: /^Persona.*añadir/ }).click();
  await page.getByLabel("Nombre en el grafo").fill("Persona A");
  await page.getByRole("button", { name: "Aplicar cambios" }).click();
  await page.getByRole("button", { name: /^Teléfono.*añadir/ }).click();
  await page.getByLabel("Nombre en el grafo").fill("Teléfono de A");
  await page.getByRole("button", { name: "Aplicar cambios" }).click();
  await entities.getByRole("button", { name: /Persona A/ }).click();
  await page.getByRole("button", { name: /Modo conectar/ }).click();
  await entities.getByRole("button", { name: /Teléfono de A/ }).click();
  await page.getByRole("dialog", { name: "Nueva relación" }).getByRole("button", { name: "Crear relación" }).click();
  await expect(page.locator("[data-save-status]")).toHaveAttribute("data-save-status", "saved", { timeout: 15_000 });

  // Cerrar sesión desde el editor: la sesión muere en el servidor.
  await page.goto("/");
  await logoutViaUi(page);
  expect((await page.request.get("/api/v1/graphs")).status()).toBe(401);
  expect((await page.request.get(`/api/v1/graphs/${id}/content`)).status()).toBe(401);

  // Volver a entrar y recuperar exactamente lo guardado.
  await loginViaUi(page, email);
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/graphs/${id}/editor`);
  await expect(entities.getByRole("button", { name: /Persona A/ })).toBeVisible();
  await expect(entities.getByRole("button", { name: /Teléfono de A/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Relaciones \(1\)/ })).toBeVisible();

  // Refrescar no cambia nada ni deja cambios pendientes.
  await page.reload();
  await expect(entities.getByRole("button", { name: /Persona A/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Relaciones \(1\)/ })).toBeVisible();
  await expect(page.locator("[data-save-status]")).toHaveAttribute("data-save-status", "saved");
});
