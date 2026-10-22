import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MAX_GRAPHS_PER_USER } from "../src/common/limits.js";
import { mkFolder, mkGraph, resetDatabase, seedContent } from "./helpers/domain.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("grafos: metadatos, papelera, duplicado y panel (API real + MySQL)", () => {
  let t: TestApp;
  let U: Awaited<ReturnType<typeof register>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    U = await register(t);
  });

  describe("crear, leer y editar", () => {
    it("crea un grafo con valores por defecto correctos y sin exponer el propietario", async () => {
      const res = await U.agent.post("/api/v1/graphs").send({ name: "  Mi caso  ", description: "  nota  " });
      expect(res.status).toBe(201);
      expect(res.body.graph).toMatchObject({
        name: "Mi caso",
        description: "nota",
        folderId: null,
        revision: 1,
        graphDataVersion: 1,
        deletedAt: null,
        nodeCount: 0,
        edgeCount: 0,
      });
      expect(res.body.graph.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(res.body)).not.toMatch(/ownerId/);
      const row = await t.prisma.graph.findUniqueOrThrow({ where: { id: res.body.graph.id } });
      expect(row.ownerId).toBe(U.userId); // el propietario sale de la sesión
    });

    it("valida el cuerpo: nombre obligatorio, límites y campos no permitidos", async () => {
      const bad: Array<Record<string, unknown>> = [
        {},
        { name: "" },
        { name: "x".repeat(201) },
        { name: "ok", description: "x".repeat(2001) },
        { name: "ok", description: "mal\u0000" },
        { name: "ok", ownerId: randomUUID() },
        { name: "ok", revision: 99 },
        { name: "ok", deletedAt: "2000-01-01" },
        { name: "ok", folderId: "no-uuid" },
      ];
      for (const body of bad) {
        const res = await U.agent.post("/api/v1/graphs").send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(await t.prisma.graph.count()).toBe(0);
    });

    it("la descripción admite saltos de línea", async () => {
      const res = await U.agent.post("/api/v1/graphs").send({ name: "g", description: "línea 1\nlínea 2" });
      expect(res.status).toBe(201);
      expect(res.body.graph.description).toBe("línea 1\nlínea 2");
    });

    it("GET devuelve el grafo; un UUID inexistente da 404 y uno mal formado 400", async () => {
      const id = await mkGraph(U.agent, "g");
      expect((await U.agent.get(`/api/v1/graphs/${id}`)).body.graph.id).toBe(id);
      expect((await U.agent.get(`/api/v1/graphs/${randomUUID()}`)).status).toBe(404);
      expect((await U.agent.get("/api/v1/graphs/xyz")).status).toBe(400);
    });

    it("PATCH renombra, cambia la descripción y mueve entre carpetas y a la raíz SIN tocar la revisión", async () => {
      const f = await mkFolder(U.agent, "f");
      const id = await mkGraph(U.agent, "g");
      const r1 = await U.agent.patch(`/api/v1/graphs/${id}`).send({ name: "g2", description: "d", folderId: f });
      expect(r1.body.graph).toMatchObject({ name: "g2", description: "d", folderId: f, revision: 1 });
      const r2 = await U.agent.patch(`/api/v1/graphs/${id}`).send({ folderId: null });
      expect(r2.body.graph).toMatchObject({ name: "g2", folderId: null });
    });

    it("PATCH no permite cambiar campos internos", async () => {
      const id = await mkGraph(U.agent, "g");
      for (const extra of [{ revision: 5 }, { ownerId: randomUUID() }, { deletedAt: null }, { id: randomUUID() }]) {
        expect((await U.agent.patch(`/api/v1/graphs/${id}`).send(extra)).status).toBe(400);
      }
    });

    it("un grafo en la papelera no se puede editar (409)", async () => {
      const id = await mkGraph(U.agent, "g");
      await U.agent.delete(`/api/v1/graphs/${id}`);
      const res = await U.agent.patch(`/api/v1/graphs/${id}`).send({ name: "x" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_IN_TRASH");
    });

    it("límite de grafos por usuario", async () => {
      await t.prisma.graph.createMany({
        data: Array.from({ length: MAX_GRAPHS_PER_USER }, (_, i) => ({ ownerId: U.userId, name: `g${i}` })),
      });
      const res = await U.agent.post("/api/v1/graphs").send({ name: "uno más" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_LIMIT_REACHED");
    });
  });

  describe("listado, búsqueda y paginación", () => {
    it("pagina de forma estable y devuelve el total", async () => {
      for (let i = 0; i < 7; i++) await mkGraph(U.agent, `g${i}`);
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await U.agent.get(`/api/v1/graphs?pageSize=3&page=${page}&sort=name&order=asc`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ page, pageSize: 3, total: 7 });
        seen.push(...res.body.items.map((g: { name: string }) => g.name));
      }
      expect(seen).toEqual(["g0", "g1", "g2", "g3", "g4", "g5", "g6"]);
      expect((await U.agent.get("/api/v1/graphs?pageSize=3&page=9")).body.items).toEqual([]);
    });

    it("ordena por nombre en ambos sentidos y por defecto por actualización descendente", async () => {
      const a = await mkGraph(U.agent, "Alfa");
      await mkGraph(U.agent, "Beta");
      const desc = await U.agent.get("/api/v1/graphs?sort=name&order=desc");
      expect(desc.body.items.map((g: { name: string }) => g.name)).toEqual(["Beta", "Alfa"]);
      await U.agent.patch(`/api/v1/graphs/${a}`).send({ description: "toco Alfa" });
      const def = await U.agent.get("/api/v1/graphs");
      expect(def.body.items[0].name).toBe("Alfa");
    });

    it("busca por nombre o descripción sin distinguir mayúsculas", async () => {
      await mkGraph(U.agent, "Red criminal Norte");
      const id = await mkGraph(U.agent, "Otro");
      await U.agent.patch(`/api/v1/graphs/${id}`).send({ description: "Contiene la palabra ZORRO" });
      await mkGraph(U.agent, "Sin relación");
      const byName = await U.agent.get("/api/v1/graphs?search=criminal");
      expect(byName.body.items.map((g: { name: string }) => g.name)).toEqual(["Red criminal Norte"]);
      const byDesc = await U.agent.get("/api/v1/graphs?search=zorro");
      expect(byDesc.body.total).toBe(1);
      expect((await U.agent.get("/api/v1/graphs?search=nadie")).body.total).toBe(0);
    });

    it("filtra por carpeta, por 'root' y por papelera", async () => {
      const f = await mkFolder(U.agent, "f");
      const inF = await mkGraph(U.agent, "enF", f);
      const inRoot = await mkGraph(U.agent, "enRaiz");
      const gone = await mkGraph(U.agent, "borrado", f);
      await U.agent.delete(`/api/v1/graphs/${gone}`);

      const names = async (qs: string) =>
        ((await U.agent.get(`/api/v1/graphs?${qs}`)).body.items as Array<{ name: string }>).map((g) => g.name).sort();
      expect(await names(`folderId=${f}`)).toEqual(["enF"]);
      expect(await names("folderId=root")).toEqual(["enRaiz"]);
      expect(await names("")).toEqual(["enF", "enRaiz"]);
      expect(await names("trashed=true")).toEqual(["borrado"]);
      expect(inF && inRoot).toBeTruthy();
    });

    it("recuentos de nodos y aristas en el listado", async () => {
      const id = await mkGraph(U.agent, "con datos");
      await seedContent(t, id, 4, 3);
      const res = await U.agent.get("/api/v1/graphs");
      expect(res.body.items[0]).toMatchObject({ nodeCount: 4, edgeCount: 3 });
    });

    it("rechaza parámetros inválidos o desconocidos", async () => {
      for (const qs of [
        "pageSize=1000",
        "pageSize=0",
        "page=0",
        "page=abc",
        "sort=ownerId",
        "order=sideways",
        "folderId=zzz",
        "trashed=quizas",
        "ownerId=" + randomUUID(),
        "search=" + "x".repeat(101),
      ]) {
        expect((await U.agent.get(`/api/v1/graphs?${qs}`)).status, qs).toBe(400);
      }
    });
  });

  describe("papelera", () => {
    it("enviar a la papelera, listar, restaurar y borrar definitivamente", async () => {
      const id = await mkGraph(U.agent, "g");
      await seedContent(t, id, 3, 2);

      expect((await U.agent.delete(`/api/v1/graphs/${id}`)).status).toBe(204);
      expect((await U.agent.get("/api/v1/graphs")).body.total).toBe(0);
      expect((await U.agent.get("/api/v1/graphs?trashed=true")).body.items[0].id).toBe(id);
      expect((await U.agent.get(`/api/v1/graphs/${id}`)).body.graph.deletedAt).not.toBeNull();
      // Segundo envío a la papelera: ya no está activo.
      expect((await U.agent.delete(`/api/v1/graphs/${id}`)).status).toBe(404);

      const restored = await U.agent.post(`/api/v1/graphs/${id}/restore`);
      expect(restored.status).toBe(200);
      expect(restored.body.graph.deletedAt).toBeNull();
      expect(restored.body.graph.nodeCount).toBe(3);
      expect((await U.agent.post(`/api/v1/graphs/${id}/restore`)).status).toBe(404); // ya está activo

      await U.agent.delete(`/api/v1/graphs/${id}`);
      expect((await U.agent.delete(`/api/v1/graphs/${id}/permanent`)).status).toBe(204);
      expect((await U.agent.get(`/api/v1/graphs/${id}`)).status).toBe(404);
      expect(await t.prisma.graphNode.count({ where: { graphId: id } })).toBe(0);
      expect(await t.prisma.graphEdge.count({ where: { graphId: id } })).toBe(0);
    });

    it("el borrado definitivo SOLO funciona desde la papelera", async () => {
      const id = await mkGraph(U.agent, "g");
      expect((await U.agent.delete(`/api/v1/graphs/${id}/permanent`)).status).toBe(404);
      expect(await t.prisma.graph.count({ where: { id } })).toBe(1);
    });

    it("el borrado definitivo purga también las exportaciones del grafo (la purga de los objetos se prueba en exports.e2e)", async () => {
      const id = await mkGraph(U.agent, "g");
      await t.prisma.exportFile.create({
        data: { ownerId: U.userId, graphId: id, name: "x", format: "PNG", storageKey: `exports/${U.userId}/${randomUUID()}`, fileSize: 10, sha256: "a".repeat(64) },
      });
      await U.agent.delete(`/api/v1/graphs/${id}`);
      expect((await U.agent.delete(`/api/v1/graphs/${id}/permanent`)).status).toBe(204);
      expect(await t.prisma.graph.count({ where: { id } })).toBe(0);
      expect(await t.prisma.exportFile.count({ where: { graphId: id } })).toBe(0);
    });
  });
  describe("duplicar", () => {
    it("copia nodos y aristas con IDs nuevos conservando la estructura y sin tocar el original", async () => {
      const f = await mkFolder(U.agent, "f");
      const src = await mkGraph(U.agent, "Original", f);
      const { nodeIds, edgeIds } = await seedContent(t, src, 5, 4);

      const res = await U.agent.post(`/api/v1/graphs/${src}/duplicate`).send({});
      expect(res.status).toBe(201);
      const copy = res.body.graph;
      expect(copy).toMatchObject({ name: "Original (copia)", folderId: f, revision: 1, nodeCount: 5, edgeCount: 4 });
      expect(copy.id).not.toBe(src);

      const [origNodes, copyNodes, origEdges, copyEdges] = await Promise.all([
        t.prisma.graphNode.findMany({ where: { graphId: src }, orderBy: { label: "asc" } }),
        t.prisma.graphNode.findMany({ where: { graphId: copy.id }, orderBy: { label: "asc" } }),
        t.prisma.graphEdge.findMany({ where: { graphId: src } }),
        t.prisma.graphEdge.findMany({ where: { graphId: copy.id } }),
      ]);
      // IDs completamente nuevos
      expect(copyNodes.some((n) => nodeIds.includes(n.id))).toBe(false);
      expect(copyEdges.some((e) => edgeIds.includes(e.id))).toBe(false);
      // Mismo contenido
      expect(copyNodes.map((n) => [n.type, n.label, n.tags, n.metadata, n.positionX, n.positionY])).toEqual(
        origNodes.map((n) => [n.type, n.label, n.tags, n.metadata, n.positionX, n.positionY]),
      );
      // Las aristas de la copia SOLO apuntan a nodos de la copia (y conservan la topología)
      const copyNodeIds = new Set(copyNodes.map((n) => n.id));
      expect(copyEdges.every((e) => copyNodeIds.has(e.sourceNodeId) && copyNodeIds.has(e.targetNodeId))).toBe(true);
      const labelOf = (nodes: typeof origNodes) => new Map(nodes.map((n) => [n.id, n.label]));
      const topo = (edges: typeof origEdges, nodes: typeof origNodes) =>
        edges.map((e) => `${labelOf(nodes).get(e.sourceNodeId)}->${labelOf(nodes).get(e.targetNodeId)}:${e.label}`).sort();
      expect(topo(copyEdges, copyNodes)).toEqual(topo(origEdges, origNodes));
      // El original no cambió
      expect(origNodes).toHaveLength(5);
      expect(origEdges).toHaveLength(4);
    });

    it("permite elegir nombre y carpeta destino (incluida la raíz) y recorta nombres demasiado largos", async () => {
      const f = await mkFolder(U.agent, "f");
      const src = await mkGraph(U.agent, "x".repeat(200), f);
      const auto = await U.agent.post(`/api/v1/graphs/${src}/duplicate`).send({});
      expect(auto.body.graph.name).toHaveLength(200);
      const custom = await U.agent.post(`/api/v1/graphs/${src}/duplicate`).send({ name: "Copia B", folderId: null });
      expect(custom.body.graph).toMatchObject({ name: "Copia B", folderId: null });
    });

    it("no se puede duplicar un grafo en la papelera", async () => {
      const src = await mkGraph(U.agent, "g");
      await U.agent.delete(`/api/v1/graphs/${src}`);
      const res = await U.agent.post(`/api/v1/graphs/${src}/duplicate`).send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_IN_TRASH");
    });

    it("duplicar es atómico: si falla (límite alcanzado) no queda una copia a medias", async () => {
      const src = await mkGraph(U.agent, "g");
      await seedContent(t, src, 3, 2);
      await t.prisma.graph.createMany({
        data: Array.from({ length: MAX_GRAPHS_PER_USER - 1 }, (_, i) => ({ ownerId: U.userId, name: `r${i}` })),
      });
      const res = await U.agent.post(`/api/v1/graphs/${src}/duplicate`).send({});
      expect(res.status).toBe(409);
      expect(await t.prisma.graph.count({ where: { ownerId: U.userId } })).toBe(MAX_GRAPHS_PER_USER);
    });
  });

  describe("panel (dashboard)", () => {
    it("devuelve recuentos, nodos por tipo y grafos recientes (sin contar la papelera)", async () => {
      await mkFolder(U.agent, "f1");
      await mkFolder(U.agent, "f2");
      const a = await mkGraph(U.agent, "A");
      const b = await mkGraph(U.agent, "B");
      const c = await mkGraph(U.agent, "C");
      await seedContent(t, a, 4, 3); // 2 person + 2 phone
      await seedContent(t, b, 2, 1); // 1 person + 1 phone
      await seedContent(t, c, 6, 5); // en la papelera: no cuenta
      await U.agent.delete(`/api/v1/graphs/${c}`);

      const res = await U.agent.get("/api/v1/dashboard");
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({ graphs: 2, trashedGraphs: 1, folders: 2, nodes: 6, edges: 4, exports: 0 });
      expect(res.body.nodesByType).toEqual({ person: 3, phone: 3 });
      expect(res.body.recentGraphs.map((g: { name: string }) => g.name).sort()).toEqual(["A", "B"]);
      expect(JSON.stringify(res.body)).not.toMatch(/ownerId/);
    });

    it("un usuario nuevo recibe todo a cero", async () => {
      const res = await U.agent.get("/api/v1/dashboard");
      expect(res.body.counts).toEqual({ graphs: 0, trashedGraphs: 0, folders: 0, nodes: 0, edges: 0, exports: 0 });
      expect(res.body.recentGraphs).toEqual([]);
    });
  });

  it("todas las rutas exigen sesión", async () => {
    const id = randomUUID();
    const calls = [
      ["get", "/api/v1/graphs"],
      ["post", "/api/v1/graphs"],
      ["get", `/api/v1/graphs/${id}`],
      ["patch", `/api/v1/graphs/${id}`],
      ["delete", `/api/v1/graphs/${id}`],
      ["post", `/api/v1/graphs/${id}/restore`],
      ["delete", `/api/v1/graphs/${id}/permanent`],
      ["post", `/api/v1/graphs/${id}/duplicate`],
      ["get", "/api/v1/folders"],
      ["post", "/api/v1/folders"],
      ["get", `/api/v1/folders/${id}`],
      ["patch", `/api/v1/folders/${id}`],
      ["delete", `/api/v1/folders/${id}`],
      ["get", "/api/v1/dashboard"],
    ] as const;
    for (const [method, path] of calls) {
      const res = await t.agent()[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
