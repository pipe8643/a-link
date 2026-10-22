import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

export const STACK_URL = process.env.STACK_URL ?? "https://localhost:8443";
/** Contraseña sintética que cumple la política (≥12, sin el correo). */
export const PASSWORD = "Una-Frase-Larga-2026!";
export const HAS_LICENSE = process.env.STACK_HAS_LICENSE === "1";

export const uniqueEmail = (tag: string) => `${tag}.${Date.now().toString(36)}${randomBytes(3).toString("hex")}@example.test`;

export async function apiCall(request: APIRequestContext, method: "POST" | "GET" | "PATCH" | "PUT" | "DELETE", url: string, data?: unknown) {
  // Las peticiones que modifican estado exigen un Origin permitido (defensa CSRF).
  return request.fetch(`/api/v1${url}`, { method, headers: { Origin: STACK_URL }, data });
}

export async function registerViaApi(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  const res = await apiCall(page.request, "POST", "/auth/register", { email, password: PASSWORD, displayName: "Usuario Demo" });
  expect(res.status(), await res.text()).toBe(201);
  return { email, password: PASSWORD };
}

export async function createGraph(page: Page, name: string): Promise<string> {
  const res = await apiCall(page.request, "POST", "/graphs", { name });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { graph?: { id: string }; id?: string };
  return (body.graph?.id ?? body.id)!;
}

/** Grafo sintético de `count` entidades en una elipse, unidas en cadena. */
export function syntheticGraph(count = 12) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    type: ["person", "organization", "bank_account", "phone"][i % 4]!,
    label: `Entidad ${i}`,
    description: "",
    notes: "",
    tags: [],
    metadata: {},
    positionX: Math.round(500 * Math.cos((i / count) * 2 * Math.PI)),
    positionY: Math.round(300 * Math.sin((i / count) * 2 * Math.PI)),
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: crypto.randomUUID(),
    sourceId: nodes[i]!.id,
    targetId: n.id,
    relationshipType: "contact",
    label: "",
    metadata: { direction: "forward", evidenceClass: "recorded" },
  }));
  return { nodes, edges };
}

export async function seedGraph(page: Page, name: string, count = 12) {
  const id = await createGraph(page, name);
  const g = syntheticGraph(count);
  const put = await apiCall(page.request, "PUT", `/graphs/${id}/content`, { expectedRevision: 1, ...g });
  expect(put.status(), await put.text()).toBe(200);
  return { id, ...g };
}

/**
 * Registra las infracciones de la política de seguridad de contenido y las peticiones a otros orígenes.
 * Hay que llamarlo ANTES de navegar.
 */
export async function watchSecurity(page: Page) {
  const violations: string[] = [];
  const foreignRequests = new Set<string>();
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const where = e.sourceFile ? ` en ${e.sourceFile.split("/").pop()}:${e.lineNumber}` : "";
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}${where}`);
    });
  });
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) violations.push(`consola: ${m.text().slice(0, 200)}`);
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "http:" || u.protocol === "https:") {
      if (u.origin !== STACK_URL) foreignRequests.add(u.origin);
    }
  });
  return {
    foreignRequests,
    /** Infracciones vistas desde la página (evento) y desde la consola. */
    async violations() {
      const fromPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => [] as string[]);
      return [...violations, ...fromPage];
    },
  };
}
