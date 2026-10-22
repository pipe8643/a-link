import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { errorShape, mkFolder, mkGraph, resetDatabase } from "./helpers/domain.js";
import { MIME, makeCleanPng, makePng } from "./helpers/files.js";
import { type TestApp, TEST_ORIGIN, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

type Agent = Awaited<ReturnType<typeof register>>["agent"];
type Method = "get" | "post" | "put" | "patch" | "delete";
interface Route {
  method: Method;
  /** Plantilla con parámetros, p. ej. `/api/v1/graphs/:id/content`. */
  path: string;
}

/** Rutas públicas (sin sesión). Cualquier ruta nueva que no esté aquí DEBE exigir sesión o este fichero falla. */
const PUBLIC_ROUTES = new Set([
  "get /api/v1/health",
  "post /api/v1/auth/register",
  "post /api/v1/auth/login",
  "post /api/v1/auth/logout",
  "post /api/v1/auth/forgot-password",
  "post /api/v1/auth/reset-password",
  // Enlaces de solo lectura: la autorización es el token (cabecera X-Share-Token), no la sesión. Ver shares.e2e.test.ts.
  "get /api/v1/shared/graph",
  "get /api/v1/shared/images/:imageId",
]);

/** Inventario REAL de rutas montadas en Express (no una lista escrita a mano). */
function listRoutes(t: TestApp): Route[] {
  const instance = t.app.getHttpAdapter().getInstance() as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = (instance.router ?? instance._router)?.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }> | undefined;
  if (!stack) throw new Error("No se pudo leer el inventario de rutas de Express");
  const routes: Route[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      // Solo la API. (Swagger, `/api/docs`, existe únicamente fuera de producción; en producción no se monta: ver hardening.)
      if (layer.route.path.startsWith("/api/v1/") && ["get", "post", "put", "patch", "delete"].includes(m)) routes.push({ method: m as Method, path: layer.route.path });
    }
  }
  return routes;
}
const key = (r: Route) => `${r.method} ${r.path}`;
const fill = (path: string, value: string) => path.replace(/:[A-Za-z]+/g, value);

/** Claves que NUNCA deben aparecer en una respuesta (hashes, tokens, propietario interno, clave de almacenamiento). */
const FORBIDDEN_KEYS = /^(passwordHash|tokenHash|token|ownerId|storageKey|secret|sessionSecret|resetToken)$/i;
function forbiddenKeysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (FORBIDDEN_KEYS.test(k) ? [`${path}.${k}`] : []).concat(forbiddenKeysIn(v, `${path}.${k}`)));
  }
  return [];
}

describe.skipIf(!hasDb)("batería de seguridad de la API", () => {
  let t: TestApp;
  let routes: Route[];

  beforeAll(async () => {
    t = await createTestApp();
    routes = listRoutes(t);
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
  });

  describe("inventario de rutas: denegar por defecto", () => {
    it("el inventario es real y contiene las rutas esperadas", () => {
      expect(routes.length).toBeGreaterThanOrEqual(30);
      expect(routes.map(key)).toEqual(expect.arrayContaining(["get /api/v1/graphs", "post /api/v1/graphs/:graphId/exports", "get /api/v1/files/:id/content"]));
    });

    it("el inventario detecta una ruta añadida sin protección (la comprobación de «denegar por defecto» no es vacía)", async () => {
      const rogue = await createTestApp();
      try {
        const express = rogue.app.getHttpAdapter().getInstance() as { get(path: string, h: (req: unknown, res: { json(b: unknown): void }) => void): void };
        express.get("/api/v1/rogue-open-route", (_req, res) => res.json({ open: true }));
        const found = listRoutes(rogue).map(key);
        expect(found).toContain("get /api/v1/rogue-open-route");
        const res = await rogue.raw().get("/api/v1/rogue-open-route").set("Origin", TEST_ORIGIN);
        expect(res.status, "una ruta sin guardián responde sin sesión: el inventario la marcaría").not.toBe(401);
        expect(PUBLIC_ROUTES.has("get /api/v1/rogue-open-route")).toBe(false);
      } finally {
        await rogue.close();
      }
    });

    it("las rutas públicas declaradas existen y no hay otras públicas: todo lo demás responde 401 sin sesión", async () => {
      const existing = new Set(routes.map(key));
      for (const p of PUBLIC_ROUTES) expect(existing, `la ruta pública ${p} ya no existe: actualiza la lista`).toContain(p);

      const offenders: string[] = [];
      for (const r of routes) {
        if (PUBLIC_ROUTES.has(key(r))) continue;
        const res = await t.raw()[r.method](fill(r.path, randomUUID())).set("Origin", TEST_ORIGIN).send();
        if (res.status !== 401) offenders.push(`${key(r)} -> ${res.status}`);
        expect(res.headers["set-cookie"], key(r)).toBeUndefined();
      }
      expect(offenders, "rutas accesibles sin sesión").toEqual([]);
    });

    it("una cookie de sesión falsa, mal formada o con otro prefijo no da acceso a ninguna ruta", async () => {
      const cookies = [`${t.config.sessionCookieName}=${"a".repeat(43)}`, `${t.config.sessionCookieName}=`, `${t.config.sessionCookieName}=${randomUUID()}`, "alink_sid=../../etc/passwd"];
      for (const cookie of cookies) {
        for (const r of routes.filter((x) => !PUBLIC_ROUTES.has(key(x)))) {
          const res = await t.raw()[r.method](fill(r.path, randomUUID())).set("Origin", TEST_ORIGIN).set("Cookie", cookie).send();
          expect(res.status, `${key(r)} con cookie ${cookie.slice(0, 20)}`).toBe(401);
        }
      }
    });
  });

  describe("aislamiento A/B: TODAS las rutas con identificador", () => {
    let A: Awaited<ReturnType<typeof register>>;
    let B: Awaited<ReturnType<typeof register>>;
    interface Ids {
      folder: string;
      graph: string;
      file: string;
      image: string;
      share: string;
      session: string;
      revision: number;
    }
    let b: Ids;
    let ghost: Ids;

    const png = () => makePng();
    const upload = (agent: Agent, graphId: string, query = "") =>
      agent.post(`/api/v1/graphs/${graphId}/exports${query}`).set("Content-Type", MIME.png).set("X-Export-Name", encodeURIComponent("secreto")).send(png());

    /** Cómo ataca A cada ruta con identificador. La CLAVE debe coincidir con una ruta real: lo comprueba el inventario. */
    const attacks: Record<string, (a: Agent, i: Ids) => Promise<{ status: number; body: Record<string, unknown> }>> = {
      "get /api/v1/folders/:id": (a, i) => a.get(`/api/v1/folders/${i.folder}`),
      "patch /api/v1/folders/:id": (a, i) => a.patch(`/api/v1/folders/${i.folder}`).send({ name: "robada" }),
      "delete /api/v1/folders/:id": (a, i) => a.delete(`/api/v1/folders/${i.folder}`),
      "get /api/v1/graphs/:id": (a, i) => a.get(`/api/v1/graphs/${i.graph}`),
      "patch /api/v1/graphs/:id": (a, i) => a.patch(`/api/v1/graphs/${i.graph}`).send({ name: "robado" }),
      "delete /api/v1/graphs/:id": (a, i) => a.delete(`/api/v1/graphs/${i.graph}`),
      "post /api/v1/graphs/:id/restore": (a, i) => a.post(`/api/v1/graphs/${i.graph}/restore`).send(),
      "delete /api/v1/graphs/:id/permanent": (a, i) => a.delete(`/api/v1/graphs/${i.graph}/permanent`),
      "get /api/v1/graphs/:id/content": (a, i) => a.get(`/api/v1/graphs/${i.graph}/content`),
      "put /api/v1/graphs/:id/content": (a, i) => a.put(`/api/v1/graphs/${i.graph}/content`).send({ expectedRevision: i.revision, nodes: [], edges: [] }),
      "post /api/v1/graphs/:id/duplicate": (a, i) => a.post(`/api/v1/graphs/${i.graph}/duplicate`).send({}),
      "get /api/v1/graphs/:graphId/exports": (a, i) => a.get(`/api/v1/graphs/${i.graph}/exports`),
      "post /api/v1/graphs/:graphId/exports": (a, i) => upload(a, i.graph),
      "get /api/v1/graphs/:graphId/images/:imageId": (a, i) => a.get(`/api/v1/graphs/${i.graph}/images/${i.image}`),
      "post /api/v1/graphs/:graphId/images": (a, i) => a.post(`/api/v1/graphs/${i.graph}/images`).set("Content-Type", MIME.png).send(makeCleanPng(9, 9, "attack")),
      "get /api/v1/graphs/:graphId/shares": (a, i) => a.get(`/api/v1/graphs/${i.graph}/shares`),
      "post /api/v1/graphs/:graphId/shares": (a, i) => a.post(`/api/v1/graphs/${i.graph}/shares`).send({ days: 30 }),
      "delete /api/v1/graphs/:graphId/shares/:shareId": (a, i) => a.delete(`/api/v1/graphs/${i.graph}/shares/${i.share}`),
      "get /api/v1/files/:id": (a, i) => a.get(`/api/v1/files/${i.file}`),
      "patch /api/v1/files/:id": (a, i) => a.patch(`/api/v1/files/${i.file}`).send({ name: "robado" }),
      "delete /api/v1/files/:id": (a, i) => a.delete(`/api/v1/files/${i.file}`),
      "get /api/v1/files/:id/content": (a, i) => a.get(`/api/v1/files/${i.file}/content`),
      "delete /api/v1/auth/sessions/:id": (a, i) => a.delete(`/api/v1/auth/sessions/${i.session}`),
    };

    beforeEach(async () => {
      A = await register(t);
      B = await register(t);
      const folder = await mkFolder(B.agent, "Carpeta de B");
      const graph = await mkGraph(B.agent, "Grafo de B", folder);
      const put = await B.agent.put(`/api/v1/graphs/${graph}/content`).send({
        expectedRevision: 1,
        nodes: [{ id: randomUUID(), type: "person", label: "Secreto de B" }],
        edges: [],
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const file = (await upload(B.agent, graph)).body.file.id as string;
      const image = (await B.agent.post(`/api/v1/graphs/${graph}/images`).set("Content-Type", MIME.png).send(makeCleanPng(8, 8, "b-img"))).body.image.id as string;
      const share = (await B.agent.post(`/api/v1/graphs/${graph}/shares`).send({ days: 7 })).body.share.id as string;
      const session = (await t.prisma.session.findFirstOrThrow({ where: { userId: B.userId } })).id;
      b = { folder, graph, file, image, share, session, revision: put.body.revision as number };
      ghost = { folder: randomUUID(), graph: randomUUID(), file: randomUUID(), image: randomUUID(), share: randomUUID(), session: randomUUID(), revision: b.revision };
    });

    it("cada ruta con parámetro de ruta tiene su ataque definido (una ruta nueva sin prueba A/B hace fallar esto)", () => {
      const withParams = routes.filter((r) => r.path.includes(":") && !PUBLIC_ROUTES.has(key(r))).map(key);
      expect(withParams.filter((k) => !attacks[k]), "rutas con identificador sin prueba de aislamiento").toEqual([]);
      expect(Object.keys(attacks).filter((k) => !withParams.includes(k)), "ataques definidos para rutas que ya no existen").toEqual([]);
    });

    it("A recibe el MISMO 404 ante un recurso de B que ante un identificador inexistente, en TODAS las rutas", async () => {
      for (const [name, attack] of Object.entries(attacks)) {
        const foreign = await attack(A.agent, b);
        const missing = await attack(A.agent, ghost);
        expect(foreign.status, `${name}: recurso ajeno`).toBe(404);
        expect(missing.status, `${name}: recurso inexistente`).toBe(404);
        expect(errorShape(foreign.body), name).toEqual(errorShape(missing.body));
      }
    });

    it("tras todos los ataques de A, lo de B está INTACTO (nada borrado, renombrado, movido ni subido)", async () => {
      for (const attack of Object.values(attacks)) await attack(A.agent, b);

      expect((await B.agent.get(`/api/v1/folders/${b.folder}`)).body.folder.name).toBe("Carpeta de B");
      const graph = (await B.agent.get(`/api/v1/graphs/${b.graph}`)).body.graph;
      expect(graph).toMatchObject({ name: "Grafo de B", folderId: b.folder });
      expect(graph.deletedAt ?? null).toBeNull();
      const content = (await B.agent.get(`/api/v1/graphs/${b.graph}/content`)).body;
      expect(content.nodes.map((n: { label: string }) => n.label)).toEqual(["Secreto de B"]);
      expect(content.revision).toBe(b.revision);
      const files = (await B.agent.get(`/api/v1/graphs/${b.graph}/exports`)).body.items;
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ id: b.file, name: "secreto" });
      expect((await B.agent.get(`/api/v1/files/${b.file}/content`)).status).toBe(200);
      expect((await B.agent.get(`/api/v1/graphs/${b.graph}/images/${b.image}`)).status).toBe(200);
      const shares = (await B.agent.get(`/api/v1/graphs/${b.graph}/shares`)).body.items as Array<{ id: string; revokedAt: string | null }>;
      expect(shares.map((s) => [s.id, s.revokedAt])).toEqual([[b.share, null]]);
      expect(await t.prisma.graphImage.count({ where: { ownerId: A.userId } })).toBe(0);
      expect(await t.prisma.shareLink.count({ where: { ownerId: A.userId } })).toBe(0);
      expect((await B.agent.get("/api/v1/users/me")).status).toBe(200);
      expect(await t.prisma.session.count({ where: { userId: B.userId, revokedAt: null } })).toBeGreaterThanOrEqual(1);
      // A no se quedó con nada de B.
      expect(await t.prisma.graph.count({ where: { ownerId: A.userId } })).toBe(0);
      expect(await t.prisma.folder.count({ where: { ownerId: A.userId } })).toBe(0);
      expect(await t.prisma.exportFile.count({ where: { ownerId: A.userId } })).toBe(0);
    });

    it("referencias a recursos de B desde el cuerpo o la consulta de A se tratan como si no existieran", async () => {
      const ownGraph = await mkGraph(A.agent, "Grafo de A");
      const refs: Array<[string, (a: Agent, folder: string) => Promise<{ status: number; body: Record<string, unknown> }>]> = [
        ["crear grafo en carpeta ajena", (a, f) => a.post("/api/v1/graphs").send({ name: "x", folderId: f })],
        ["crear carpeta dentro de carpeta ajena", (a, f) => a.post("/api/v1/folders").send({ name: "x", parentId: f })],
        ["mover grafo propio a carpeta ajena", (a, f) => a.patch(`/api/v1/graphs/${ownGraph}`).send({ folderId: f })],
        ["duplicar a carpeta ajena", (a, f) => a.post(`/api/v1/graphs/${ownGraph}/duplicate`).send({ folderId: f })],
        ["exportar a carpeta ajena", (a, f) => a.post(`/api/v1/graphs/${ownGraph}/exports?folderId=${f}`).set("Content-Type", MIME.png).set("X-Export-Name", "x").send(png())],
      ];
      for (const [name, call] of refs) {
        const foreign = await call(A.agent, b.folder);
        const missing = await call(A.agent, ghost.folder);
        expect(foreign.status, name).toBe(missing.status);
        expect(foreign.status, name).toBeGreaterThanOrEqual(400);
        expect(errorShape(foreign.body), name).toEqual(errorShape(missing.body));
      }
      // Filtros de listado con ids de B: nada de B aparece.
      const byFolder = await A.agent.get(`/api/v1/graphs?folderId=${b.folder}`);
      expect(JSON.stringify(byFolder.body)).not.toContain("Grafo de B");
      const byGraph = await A.agent.get(`/api/v1/files?graphId=${b.graph}`);
      expect(byGraph.body.items ?? []).toEqual([]);
    });

    it("el listado de búsqueda y los contadores de A no filtran nada de B, ni con comodines ni con inyección", async () => {
      for (const q of ["Secreto", "B", "%", "_", "' OR 1=1 --", "Grafo de B", "\\"]) {
        const g = await A.agent.get("/api/v1/graphs").query({ search: q });
        expect(JSON.stringify(g.body), `graphs q=${q}`).not.toMatch(/Grafo de B|Secreto de B|Carpeta de B/);
        const f = await A.agent.get("/api/v1/files").query({ search: q });
        expect(JSON.stringify(f.body), `files q=${q}`).not.toContain("secreto");
      }
      const dash = JSON.stringify((await A.agent.get("/api/v1/dashboard")).body);
      expect(dash).not.toContain("Grafo de B");
    });
  });

  describe("CSRF: ninguna ruta que modifica estado acepta peticiones sin un Origin permitido", () => {
    it("con sesión válida, sin Origin o con Origin ajeno → 403 CSRF_ORIGIN en TODAS las rutas no seguras, y no cambia nada", async () => {
      const U = await register(t);
      const graph = await mkGraph(U.agent, "Intacto");
      const cookie = (await t.prisma.session.findFirstOrThrow({ where: { userId: U.userId } })).id; // solo para comprobar que existe
      expect(cookie).toBeTruthy();
      // El agente de pruebas fija Origin; se usa una petición suelta con la cookie del agente.
      const jar = (U.agent as unknown as { jar: { getCookies(o: { domain: string; path: string; script?: boolean; secure?: boolean }): Array<{ name: string; value: string }> } }).jar;
      const sid = jar.getCookies({ domain: "127.0.0.1", path: "/" }).find((c) => c.name.endsWith("alink_sid"))?.value;
      expect(sid, "cookie de sesión del agente").toBeTruthy();
      const cookieHeader = `${t.config.sessionCookieName}=${sid}`;

      const unsafe = routes.filter((r) => r.method !== "get");
      expect(unsafe.length).toBeGreaterThanOrEqual(15);
      for (const r of unsafe) {
        for (const origin of [undefined, "https://evil.example", "null", "http://localhost:5173.evil.example", "http://localhost:51730"]) {
          let req = t.raw()[r.method](fill(r.path, graph)).set("Cookie", cookieHeader);
          if (origin !== undefined) req = req.set("Origin", origin);
          const res = await req.send({ name: "x" });
          expect(res.status, `${key(r)} Origin=${origin}`).toBe(403);
          expect(res.body.code, `${key(r)} Origin=${origin}`).toBe("CSRF_ORIGIN");
        }
      }
      // El Referer permitido sustituye al Origin ausente (navegadores antiguos); uno ajeno no.
      const okReferer = await t.raw().post("/api/v1/folders").set("Cookie", cookieHeader).set("Referer", `${TEST_ORIGIN}/graphs`).send({ name: "ok" });
      expect(okReferer.status).toBe(201);
      const badReferer = await t.raw().post("/api/v1/folders").set("Cookie", cookieHeader).set("Referer", "https://evil.example/").send({ name: "no" });
      expect(badReferer.status).toBe(403);
      // Nada cambió.
      expect((await U.agent.get(`/api/v1/graphs/${graph}`)).body.graph.name).toBe("Intacto");
      expect((await U.agent.get("/api/v1/folders")).body.items.map((f: { name: string }) => f.name)).toEqual(["ok"]);
    });

    it("CORS: un origen ajeno no recibe permiso ni credenciales; el permitido sí", async () => {
      const foreign = await t.raw().options("/api/v1/graphs").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
      expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
      // (Access-Control-Allow-Credentials sin Allow-Origin es inerte: el navegador exige ambos.)
      const own = await t.raw().options("/api/v1/graphs").set("Origin", TEST_ORIGIN).set("Access-Control-Request-Method", "POST");
      expect(own.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
      expect(own.headers["access-control-allow-credentials"]).toBe("true");
      expect(String(own.headers["access-control-allow-origin"])).not.toBe("*");
      const get = await t.raw().get("/api/v1/health").set("Origin", "https://evil.example");
      expect(get.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("cabeceras de seguridad y higiene de las respuestas", () => {
    it("TODAS las respuestas (éxito, 401, 404, 400, 403) llevan nosniff, no-store, X-Request-Id y no anuncian la tecnología", async () => {
      const U = await register(t);
      // Funciones: supertest abre su servidor al esperar la petición, no al crearla.
      const calls = [
        () => t.raw().get("/api/v1/health"),
        () => t.raw().get("/api/v1/users/me"),
        () => t.raw().get("/api/v1/no-existe"),
        () => U.agent.get("/api/v1/users/me"),
        () => U.agent.get(`/api/v1/graphs/${randomUUID()}`),
        () => U.agent.get("/api/v1/graphs/no-uuid"),
        () => t.raw().post("/api/v1/auth/login").send({}),
        () => U.agent.post("/api/v1/graphs").send({ name: "" }),
      ];
      for (const [i, call] of calls.entries()) {
        const res = await call();
        const h = res.headers;
        expect(h["x-content-type-options"], `llamada ${i}`).toBe("nosniff");
        expect(h["cache-control"], `llamada ${i}`).toContain("no-store");
        expect(h["x-request-id"], `llamada ${i}`).toMatch(/^[0-9a-f-]{36}$/);
        expect(h["x-powered-by"]).toBeUndefined();
        expect(h["referrer-policy"]).toBe("no-referrer");
        expect(h["content-security-policy"]).toBeDefined();
        expect(h["cross-origin-resource-policy"]).toBe("same-site");
      }
    });

    it("el identificador de petición lo genera el servidor: no se acepta el del cliente", async () => {
      const forged = "11111111-1111-1111-1111-111111111111";
      const res = await t.raw().get("/api/v1/health").set("X-Request-Id", forged);
      expect(res.headers["x-request-id"]).not.toBe(forged);
    });

    it("ninguna respuesta de las pantallas habituales contiene hashes, tokens, propietario interno ni claves de almacenamiento", async () => {
      const U = await register(t);
      const folder = await mkFolder(U.agent, "C");
      const graph = await mkGraph(U.agent, "G", folder);
      await U.agent.put(`/api/v1/graphs/${graph}/content`).send({ expectedRevision: 1, nodes: [{ id: randomUUID(), type: "person", label: "N" }], edges: [] });
      const up = await U.agent.post(`/api/v1/graphs/${graph}/exports`).set("Content-Type", MIME.png).set("X-Export-Name", "e").send(makePng());
      const fileId = up.body.file.id as string;
      const img = await U.agent.post(`/api/v1/graphs/${graph}/images`).set("Content-Type", MIME.png).send(makeCleanPng());
      const share = await U.agent.post(`/api/v1/graphs/${graph}/shares`).send({ days: 1 });
      const login = await t.agent().post("/api/v1/auth/login").send({ email: U.email, password: U.password });
      const bodies: Array<[string, unknown]> = [
        ["register", U.res.body],
        ["login", login.body],
        ["users/me", (await U.agent.get("/api/v1/users/me")).body],
        ["sessions", (await U.agent.get("/api/v1/auth/sessions")).body],
        ["folders", (await U.agent.get("/api/v1/folders")).body],
        ["folder", (await U.agent.get(`/api/v1/folders/${folder}`)).body],
        ["graphs", (await U.agent.get("/api/v1/graphs")).body],
        ["graph", (await U.agent.get(`/api/v1/graphs/${graph}`)).body],
        ["content", (await U.agent.get(`/api/v1/graphs/${graph}/content`)).body],
        ["dashboard", (await U.agent.get("/api/v1/dashboard")).body],
        ["upload", up.body],
        ["files", (await U.agent.get("/api/v1/files")).body],
        ["file", (await U.agent.get(`/api/v1/files/${fileId}`)).body],
        ["graph exports", (await U.agent.get(`/api/v1/graphs/${graph}/exports`)).body],
        ["image upload", img.body],
        // La respuesta de CREAR un enlace lleva el token (se entrega una vez, a propósito): se valida aparte que lo demás esté limpio.
        ["share create (sin el token)", { share: share.body.share }],
        ["share list", (await U.agent.get(`/api/v1/graphs/${graph}/shares`)).body],
        ["vista pública", (await t.raw().get("/api/v1/shared/graph").set("X-Share-Token", share.body.token as string)).body],
      ];
      for (const [name, body] of bodies) expect(forbiddenKeysIn(body), name).toEqual([]);
      // Ni el hash de la contraseña ni el token de sesión aparecen en ningún cuerpo, con ningún nombre de campo.
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: U.userId } });
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: U.userId } });
      const all = JSON.stringify(bodies);
      expect(all).not.toContain(user.passwordHash);
      expect(all).not.toContain(session.tokenHash);
      const link = await t.prisma.shareLink.findFirstOrThrow({ where: { graphId: graph } });
      expect(all).not.toContain(link.tokenHash);
      expect(JSON.stringify(bodies.slice(-2))).not.toContain(share.body.token as string); // listado y vista pública no reenvían el token
    });
  });

  describe("robustez ante entradas hostiles: nunca un 5xx, nunca una fuga", () => {
    const hostileParams = ["not-a-uuid", "00000000-0000-0000-0000-000000000000", "..%2F..%2F..%2Fetc%2Fpasswd", "%00", "'%3B%20DROP%20TABLE%20users%3B--", "a".repeat(3000), "%7B%7B7*7%7D%7D", "%C3%B1", "%3Cscript%3E", "__proto__", "constructor"];
    const hostileBodies: unknown[] = [
      undefined,
      {},
      [],
      null,
      "texto",
      123,
      { __proto__: { polluted: true } },
      JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'),
      { name: 123 },
      { name: "x".repeat(50_000) },
      { name: { $ne: 1 } },
      { id: { $gt: "" }, ownerId: "x", userId: "y" },
      { expectedRevision: -1, nodes: "no", edges: null },
      { email: ["a@example.test"], password: { $ne: "" } },
      JSON.parse(`${"[".repeat(300)}${"]".repeat(300)}`),
    ];
    // Las rutas que cerrarían la sesión de quien fuzzea quedan fuera (se siguen probando con IDs hostiles).
    const SESSION_ENDING = new Set(["post /api/v1/auth/logout", "post /api/v1/auth/sessions/revoke-others", "post /api/v1/users/me/password"]);

    it("rutas × parámetros hostiles × cuerpos hostiles: siempre 4xx o 2xx, nunca 5xx; sin contaminación de prototipos", async () => {
      const U = await register(t);
      const failures: string[] = [];
      let sent = 0;
      for (const r of routes) {
        const actors: Array<[string, () => ReturnType<Agent[Method]>[]]> = [];
        void actors;
        const params = r.path.includes(":") ? hostileParams : [""];
        for (const p of params) {
          const path = r.path.includes(":") ? fill(r.path, p) : r.path;
          const bodies = r.method === "get" || r.method === "delete" ? [undefined] : hostileBodies;
          for (const body of bodies) {
            // Con sesión (salvo rutas que la cierran) y sin sesión.
            const agents: Array<Agent | ReturnType<TestApp["raw"]>> = SESSION_ENDING.has(key(r)) ? [] : [U.agent];
            for (const who of agents) {
              let req = (who as Agent)[r.method](path);
              if (body !== undefined) req = req.set("Content-Type", "application/json").send(typeof body === "string" ? JSON.stringify(body) : (body as object));
              const res = await req;
              sent++;
              if (res.status >= 500) failures.push(`${key(r)} ${p.slice(0, 20)} ${JSON.stringify(body)?.slice(0, 40)} -> ${res.status}`);
            }
            const anon = t.raw()[r.method](path).set("Origin", TEST_ORIGIN);
            const res = body === undefined ? await anon : await anon.set("Content-Type", "application/json").send(typeof body === "string" ? JSON.stringify(body) : (body as object));
            sent++;
            if (res.status >= 500) failures.push(`(anónimo) ${key(r)} ${p.slice(0, 20)} -> ${res.status}`);
          }
        }
      }
      expect(sent).toBeGreaterThan(500);
      expect(failures, "respuestas 5xx").toEqual([]);
      expect(({} as Record<string, unknown>).polluted, "contaminación de prototipos").toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    }, 300_000);

    it("JSON mal formado, tipos de contenido inesperados y cuerpos enormes dan 400/413/415, no 500", async () => {
      const U = await register(t);
      const malformed = await U.agent.post("/api/v1/graphs").set("Content-Type", "application/json").send('{"name": "x"');
      expect(malformed.status).toBe(400);
      expect(["INVALID_BODY", "HTTP_400"]).toContain(malformed.body.code);
      expect(JSON.stringify(malformed.body)).not.toMatch(/Unexpected|position|JSON\.parse|SyntaxError/);
      const big = await U.agent.post("/api/v1/graphs").set("Content-Type", "application/json").send(JSON.stringify({ name: "x".repeat(t.config.maxRequestBodyBytes + 10) }));
      expect(big.status).toBe(413);
      for (const type of ["text/plain", "application/xml", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded"]) {
        const res = await U.agent.post("/api/v1/graphs").set("Content-Type", type).send("name=x");
        expect(res.status, type).toBeLessThan(500);
        expect(res.status, type).not.toBe(201);
      }
    });
  });

  describe("registros (logs) sin datos sensibles", () => {
    it("durante registro, login, recuperación, edición y exportación no se escribe ningún secreto en los registros", async () => {
      const lines: string[] = [];
      const collector = {
        log: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
        error: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
        warn: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
        debug: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
        verbose: (...a: unknown[]) => lines.push(a.map(String).join(" ")),
      };
      const logged = await createTestApp({}, { accessLog: true });
      Logger.overrideLogger(collector);
      try {
        const SECRET_NAME = "NombreSecretoOmega";
        const SECRET_PASSWORD = "Clave-Ultra-Secreta-2026!";
        const email = `logs-${randomUUID().slice(0, 8)}@example.test`;
        const agent = logged.agent();
        const reg = await agent.post("/api/v1/auth/register").send({ email, password: SECRET_PASSWORD, displayName: SECRET_NAME });
        expect(reg.status).toBe(201);
        const sid = String(reg.headers["set-cookie"]).split(";")[0]!.split("=")[1]!;
        await logged.agent().post("/api/v1/auth/login").send({ email, password: "Clave-Equivocada-2026!" });
        await logged.agent().post("/api/v1/auth/forgot-password").send({ email });
        const resetToken = logged.mail.lastTokenFor(email);
        const folder = await mkFolder(agent, `Carpeta ${SECRET_NAME}`);
        const graph = await mkGraph(agent, `Grafo ${SECRET_NAME}`, folder);
        await agent.put(`/api/v1/graphs/${graph}/content`).send({ expectedRevision: 1, nodes: [{ id: randomUUID(), type: "person", label: SECRET_NAME, notes: SECRET_NAME }], edges: [] });
        const up = await agent.post(`/api/v1/graphs/${graph}/exports?folderId=root`).set("Content-Type", MIME.png).set("X-Export-Name", encodeURIComponent(SECRET_NAME)).send(makePng());
        expect(up.status).toBe(201);
        await agent.get(`/api/v1/graphs`).query({ search: SECRET_NAME });
        await agent.get(`/api/v1/files`).query({ search: SECRET_NAME });
        await agent.post("/api/v1/auth/reset-password").send({ token: resetToken, password: "Otra-Clave-Nueva-2026!" });
        await agent.get("/api/v1/graphs/no-uuid");

        const text = lines.join("\n");
        expect(lines.length, "el registro de acceso está activo").toBeGreaterThan(5);
        expect(text).toMatch(/GET \/api\/v1\/graphs/);
        for (const secret of [SECRET_PASSWORD, "Clave-Equivocada-2026!", "Otra-Clave-Nueva-2026!", SECRET_NAME, encodeURIComponent(SECRET_NAME), sid, resetToken, email, "Cookie", "set-cookie"]) {
          expect(text, `el registro contiene «${secret.slice(0, 12)}…»`).not.toContain(secret);
        }
        // La cadena de consulta (búsquedas) no se registra.
        expect(text).not.toContain("search=");
        expect(text).not.toContain("?");
      } finally {
        Logger.overrideLogger(false);
        await resetDatabase(logged);
        await logged.close();
      }
    });
  });
});
