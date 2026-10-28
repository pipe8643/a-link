import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { STACK_URL, apiCall, registerViaApi } from "./helpers";

/** Nginx + API de producción (TLS, cabeceras, CSP, límites, red). No necesita licencia de ZoomCharts. */
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 1500 });
    socket.once("connect", () => (socket.destroy(), resolve(false)));
    socket.once("timeout", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(true));
  });

test.describe("borde de producción: cabeceras, CSP, límites y red", () => {
  test("el frontend sale con CSP estricta y todas las cabeceras de seguridad", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const h = res.headers();
    const csp = h["content-security-policy"]!;
    for (const d of [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'", // solo compilar WebAssembly (MediaPipe); no eval()
      "connect-src 'self' https://api.zoomcharts-cloud.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "frame-src 'none'",
      "media-src 'none'",
    ]) {
      expect(csp, d).toContain(d);
    }
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(csp).not.toMatch(/\*/); // sin comodines
    expect(h["strict-transport-security"]).toMatch(/max-age=31536000/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["cache-control"]).toBe("no-cache");
    expect(h.server, "no se anuncia la versión de Nginx").toBe("nginx");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("solo /s se puede incrustar (Web Viewer); el resto sigue sin framing", async ({ request }) => {
    const share = await request.get("/s");
    expect(share.status()).toBe(200);
    const csp = share.headers()["content-security-policy"]!;
    expect(csp).toContain("frame-ancestors *");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(share.headers()["x-frame-options"] ?? "").not.toMatch(/DENY|SAMEORIGIN/i);
    const home = (await request.get("/")).headers();
    expect(home["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(home["x-frame-options"]).toBe("DENY");
    const graphs = (await request.get("/graphs")).headers();
    expect(graphs["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(graphs["x-frame-options"]).toBe("DENY");
  });

  test("la API detrás del proxy: sin cabeceras duplicadas, sin caché y sin documentación", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h["strict-transport-security"], "HSTS una sola vez").not.toMatch(/,.*max-age/);
    expect(h["cache-control"]).toBe("no-store");
    expect(h["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request.get("/api/docs")).status()).toBe(404);
    expect((await request.get("/api/docs-json")).status()).toBe(404);
  });

  test("estáticos: hash inmutable, configuración sin caché, ficheros inexistentes y ocultos dan 404", async ({ request }) => {
    const index = await (await request.get("/")).text();
    const asset = /\/assets\/[^"']+\.js/.exec(index)?.[0];
    expect(asset, "el index.html referencia un bundle con hash").toBeDefined();
    const a = await request.get(asset!);
    expect(a.status()).toBe(200);
    expect(a.headers()["cache-control"]).toContain("immutable");
    expect(a.headers()["content-security-policy"]).toBeDefined();
    const cfg = await request.get("/config.js");
    expect(cfg.status()).toBe(200);
    expect(cfg.headers()["cache-control"]).toBe("no-store");
    expect(await cfg.text()).toMatch(/^window\.__ALINK_CONFIG__=\{"zoomChartsLicense":"[^"\\]*","zoomChartsLicenseKey":"[^"\\]*"\};\s*$/);
    for (const p of ["/missing.js", "/.env", "/.git/config", "/assets/missing.css", "/apps/api/.env"]) {
      const r = await request.get(p);
      expect(r.status(), p).toBe(404);
      expect(r.headers()["content-type"] ?? "", p).not.toContain("javascript");
    }
    // Una ruta de la aplicación (sin extensión) sí devuelve la aplicación.
    expect((await request.get("/graphs/abc")).status()).toBe(200);
    // El bundle NO lleva la licencia compilada: solo existe en /config.js (generado al arrancar).
    const bundle = await (await request.get(asset!)).text();
    expect(bundle).not.toMatch(/zoomChartsLicenseKey"\s*:\s*"[A-Za-z0-9]{8,}/);
  });

  test("solo Nginx está expuesto: ni la API ni MySQL son alcanzables desde el equipo", async () => {
    expect(await refused(3000), "puerto 3000 (API)").toBe(true);
    // En esta máquina puede haber un MySQL propio en el 3306: se comprueba lo que Docker publica, no el puerto.
    for (const service of ["db", "api"]) {
      const published = execFileSync("docker", ["port", `a-link-${service}-1`], { encoding: "utf8" }).trim();
      expect(published, `puertos publicados por ${service}`).toBe("");
    }
    const web = execFileSync("docker", ["port", "a-link-web-1"], { encoding: "utf8" });
    expect(web).toContain("8443");
  });

  test("la cookie de sesión de producción: __Host-, Secure, HttpOnly, SameSite=Lax y sin Domain", async ({ page, context }) => {
    await registerViaApi(page, "edge1");
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name.endsWith("alink_sid"));
    expect(session, "cookie de sesión").toBeDefined();
    expect(session!.name).toBe("__Host-alink_sid");
    expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
    expect(session!.expires, "caduca (no es de sesión de navegador indefinida)").toBeGreaterThan(Date.now() / 1000);
    expect(session!.expires).toBeLessThan(Date.now() / 1000 + 15 * 86400);
  });

  test("CSRF a través del proxy: sin Origin o con un Origin ajeno se rechaza antes de tocar nada", async ({ request, page }) => {
    const body = { email: "csrf@example.test", password: "Una-Frase-Larga-2026!" };
    const none = await request.post("/api/v1/auth/login", { data: body });
    expect(none.status()).toBe(403);
    expect((await none.json()).code).toBe("CSRF_ORIGIN");
    const evil = await request.post("/api/v1/auth/login", { data: body, headers: { Origin: "https://evil.example" } });
    expect(evil.status()).toBe(403);
    // Con sesión válida pero Origin ajeno tampoco se puede modificar nada.
    await registerViaApi(page, "edge2");
    const forged = await page.request.post("/api/v1/graphs", { data: { name: "x" }, headers: { Origin: "https://evil.example" } });
    expect(forged.status()).toBe(403);
    expect(((await (await apiCall(page.request, "GET", "/graphs")).json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  test("límites de cuerpo en Nginx: auth 64 KB, resto 2 MB; la API sigue aplicando los suyos", async ({ request }) => {
    const auth = await request.post("/api/v1/auth/login", {
      headers: { Origin: STACK_URL, "Content-Type": "application/json" },
      data: JSON.stringify({ email: "a@example.test", password: "x".repeat(100_000) }),
    });
    expect(auth.status()).toBe(413);
    const big = await request.post("/api/v1/folders", {
      headers: { Origin: STACK_URL, "Content-Type": "application/json" },
      data: JSON.stringify({ name: "x".repeat(3 * 1024 * 1024) }),
    });
    expect(big.status()).toBe(413);
  });

  test("no hay mensajes de error con datos internos (pila, rutas, SQL)", async ({ page }) => {
    await registerViaApi(page, "edge3");
    for (const [method, url, data] of [
      ["GET", "/graphs/no-es-un-uuid", undefined],
      ["POST", "/graphs", { name: "" }],
      ["PUT", `/graphs/${crypto.randomUUID()}/content`, { expectedRevision: "x" }],
      ["GET", `/files/${crypto.randomUUID()}/content`, undefined],
    ] as const) {
      const r = await apiCall(page.request, method, url, data);
      const text = await r.text();
      expect(r.status(), `${method} ${url}`).toBeGreaterThanOrEqual(400);
      expect(r.status()).toBeLessThan(500);
      expect(text, `${method} ${url}`).not.toMatch(/node_modules|\/app\/|at .*\(.*:\d+:\d+\)|prisma|SELECT |mysql/i);
    }
  });
});
