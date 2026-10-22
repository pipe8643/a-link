import { expect, test } from "@playwright/test";
import { PASSWORD, loginViaUi, logoutViaUi, readResetLink, registerViaApi, uniqueEmail } from "./helpers";

test.describe("autenticación", () => {
  test("registro por la interfaz, cookie de sesión HttpOnly, cierre de sesión y retorno tras el login", async ({ page, context }) => {
    const email = uniqueEmail("alta");
    await page.goto("/register");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Repite la contraseña").fill(PASSWORD);
    const [registration] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/register") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Crear cuenta" }).click(),
    ]);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Grafos" })).toBeVisible();

    // La sesión vive SOLO en una cookie HttpOnly: JS no puede leerla y no hay tokens en el almacenamiento web.
    const session = (await context.cookies()).find((c) => c.name.includes("alink_sid"));
    expect(session, "cookie de sesión").toBeDefined();
    expect(session!.httpOnly).toBe(true);
    // SameSite se comprueba en la cabecera Set-Cookie: la lista de cookies de WebKit no informa de ese atributo (devuelve "None").
    const setCookie = (await registration.headersArray()).filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).join("\n");
    expect(setCookie).toMatch(/alink_sid=/);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    const jsVisible = await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(jsVisible).not.toContain(session!.value);
    expect(jsVisible).not.toContain("alink_sid");

    await logoutViaUi(page);
    // Tras cerrar sesión la cookie ya no sirve: la API devuelve 401.
    expect((await page.request.get("/api/v1/users/me")).status()).toBe(401);

    // Ruta protegida → login → vuelve a la ruta pedida (con su query).
    await page.goto("/graphs?q=demo");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/graphs\?q=demo$/);
  });

  test("credenciales incorrectas: mensaje genérico y sin sesión", async ({ page }) => {
    const { email } = await registerViaApi(page, "bad");
    await page.context().clearCookies();
    await loginViaUi(page, email, "Clave-Incorrecta-2026");
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    // Un correo inexistente da exactamente el mismo mensaje (no se puede enumerar cuentas).
    await loginViaUi(page, uniqueEmail("fantasma"), "Clave-Incorrecta-2026");
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  });

  test("validación en cliente: contraseña corta y confirmación distinta", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Correo electrónico").fill(uniqueEmail("val"));
    await page.getByLabel("Contraseña", { exact: true }).fill("corta");
    await page.getByLabel("Repite la contraseña").fill("otra");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /12 caracteres/ })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /no coinciden/i })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("recuperación de contraseña: enlace de un solo uso, token fuera de la URL y sesiones antiguas cerradas", async ({ page, browser }) => {
    const { email } = await registerViaApi(page, "reset");
    const NEW_PASSWORD = "Otra-Frase-Distinta-2027!";

    // Segunda sesión abierta en otro navegador: debe quedar invalidada al restablecer.
    const other = await browser.newContext({ baseURL: "http://127.0.0.1:5273" });
    const otherPage = await other.newPage();
    await loginViaUi(otherPage, email);
    await expect(otherPage).toHaveURL(/\/$/);

    await page.context().clearCookies();
    await page.goto("/forgot-password");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible();

    const link = await readResetLink(email);
    await page.goto(link);
    // El token se retira de la barra de direcciones (historial, capturas, cabecera Referer).
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Repite la contraseña").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // La contraseña antigua ya no sirve y la nueva sí.
    await loginViaUi(page, email, PASSWORD);
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
    await loginViaUi(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/$/);

    // El mismo enlace no se puede reutilizar.
    await page.context().clearCookies();
    await page.goto(link);
    await page.getByLabel("Nueva contraseña", { exact: true }).fill("Una-Tercera-Clave-2028!");
    await page.getByLabel("Repite la contraseña").fill("Una-Tercera-Clave-2028!");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /no es válido|caducado/i })).toBeVisible();

    // La sesión que estaba abierta en el otro navegador fue revocada.
    expect((await otherPage.request.get("/api/v1/users/me")).status()).toBe(401);
    await other.close();
  });
});
