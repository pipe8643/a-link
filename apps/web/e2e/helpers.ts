import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Contraseña sintética que cumple la política (≥12, sin el correo). */
export const PASSWORD = "Una-Frase-Larga-2026!";
const ORIGIN = "http://127.0.0.1:5273";
const MAIL_DIR = path.resolve(import.meta.dirname, "../../api/storage/e2e-mail");

export function uniqueEmail(tag: string) {
  return `${tag}.${Date.now().toString(36)}${randomBytes(3).toString("hex")}@example.test`;
}

/** Registra por la API (rápido) usando la misma página, de modo que su contexto queda con la cookie de sesión. */
export async function registerViaApi(page: Page, tag: string, displayName = "Usuario Demo") {
  const email = uniqueEmail(tag);
  const res = await page.request.post("/api/v1/auth/register", {
    headers: { Origin: ORIGIN }, // las peticiones no seguras exigen Origin (defensa CSRF)
    data: { email, password: PASSWORD, displayName },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email, password: PASSWORD };
}

export async function api(request: APIRequestContext, method: "POST" | "GET" | "PATCH" | "PUT" | "DELETE", url: string, data?: unknown) {
  return request.fetch(`/api/v1${url}`, { method, headers: { Origin: ORIGIN }, data });
}

export async function createGraphViaApi(page: Page, name: string, folderId?: string) {
  const res = await api(page.request, "POST", "/graphs", { name, ...(folderId ? { folderId } : {}) });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { graph?: { id: string } } & { id?: string };
  return (body.graph?.id ?? body.id)!;
}

export async function createFolderViaApi(page: Page, name: string, parentId?: string) {
  const res = await api(page.request, "POST", "/folders", { name, ...(parentId ? { parentId } : {}) });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { folder?: { id: string } } & { id?: string };
  return (body.folder?.id ?? body.id)!;
}

export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function logoutViaUi(page: Page) {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Lee el enlace de recuperación que la API (modo desarrollo/pruebas) deja en un fichero. */
export async function readResetLink(email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const files = await readdir(MAIL_DIR).catch(() => [] as string[]);
    for (const f of files.sort().reverse()) {
      const msg = JSON.parse(await readFile(path.join(MAIL_DIR, f), "utf8")) as { to: string; text: string };
      if (msg.to === email) {
        const m = /(https?:\/\/\S+)/.exec(msg.text);
        if (m) return m[1]!;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("No llegó el correo de recuperación");
}
