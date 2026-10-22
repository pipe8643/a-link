import { expect, test } from "@playwright/test";
import { HAS_LICENSE, STACK_URL, apiCall, registerViaApi, watchSecurity } from "./helpers";

/**
 * Datos de demostración (`--profile seed`). Requiere haberlos cargado:
 *   docker compose --env-file .env.docker --env-file .env.docker.test --profile seed run --rm seed
 * La contraseña no está en el repositorio: la toma el runner de .env.docker (STACK_DEMO_PASSWORD).
 */
const DEMO_EMAIL = process.env.STACK_DEMO_EMAIL ?? "demo@example.test";
const PASSWORD = process.env.STACK_DEMO_PASSWORD ?? "";

test.describe("datos de demostración", () => {
  test.skip(!PASSWORD, "Sin STACK_DEMO_PASSWORD (.env.docker) no se prueba la demostración.");

  test("el usuario de demostración entra por la interfaz y ve su carpeta y su grafo sintético", async ({ page }) => {
    const watch = await watchSecurity(page);
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(DEMO_EMAIL);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Grafos" }).click();
    await expect(page.getByText("Red de ejemplo (datos sintéticos)")).toBeVisible();

    const graphs = (await (await apiCall(page.request, "GET", "/graphs")).json()) as { items: Array<{ id: string; name: string }> };
    const graph = graphs.items.find((g) => g.name.startsWith("Red de ejemplo"))!;
    const content = (await (await apiCall(page.request, "GET", `/graphs/${graph.id}/content`)).json()) as {
      nodes: Array<{ label: string; positionX: number | null }>;
      edges: Array<{ metadata: { evidenceClass: string } }>;
    };
    expect(content.nodes).toHaveLength(14);
    expect(content.edges).toHaveLength(17);
    expect(content.nodes.every((n) => n.positionX !== null)).toBe(true);
    // Hay de los tres tipos de dato: nunca todo se presenta como hecho verificado.
    expect(new Set(content.edges.map((e) => e.metadata.evidenceClass))).toEqual(new Set(["recorded", "hypothesis", "observation"]));
    // Todo es ficticio y está marcado como tal.
    const text = JSON.stringify(content);
    expect(text).toMatch(/ficticia|inventad/i);

    if (HAS_LICENSE) {
      await page.goto(`/graphs/${graph.id}/editor`);
      await expect(page.getByTestId("net-chart")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
      expect(await watch.violations()).toEqual([]);
    }
  });

  test("la demostración es privada: otra cuenta no la ve ni puede abrirla", async ({ page, browser }) => {
    // Entra el demo en su contexto y obtiene el id de su grafo.
    const demo = await browser.newContext({ baseURL: STACK_URL, ignoreHTTPSErrors: true });
    try {
      const d = await demo.newPage();
      const login = await d.request.post("/api/v1/auth/login", { headers: { Origin: STACK_URL }, data: { email: DEMO_EMAIL, password: PASSWORD } });
      expect(login.status()).toBe(200);
      const graphs = (await (await apiCall(d.request, "GET", "/graphs")).json()) as { items: Array<{ id: string }> };
      const demoGraphId = graphs.items[0]!.id;

      await registerViaApi(page, "demob");
      expect(((await (await apiCall(page.request, "GET", "/graphs")).json()) as { items: unknown[] }).items).toHaveLength(0);
      const real = await apiCall(page.request, "GET", `/graphs/${demoGraphId}/content`);
      const none = await apiCall(page.request, "GET", `/graphs/${crypto.randomUUID()}/content`);
      expect(real.status()).toBe(404);
      expect(none.status()).toBe(404);
      const strip = (o: object) => ({ ...o, requestId: undefined });
      expect(strip(await real.json())).toEqual(strip(await none.json()));
    } finally {
      await demo.close();
    }
  });
});
