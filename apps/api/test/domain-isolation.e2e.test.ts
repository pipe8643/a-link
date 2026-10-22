import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { errorShape, mkFolder, mkGraph, resetDatabase, seedContent } from "./helpers/domain.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

/**
 * PRUEBAS A/B de aislamiento sobre carpetas, grafos y panel.
 *
 * B tiene datos reales (carpeta con subcarpeta, grafos activos y en la papelera, nodos y aristas).
 * A conoce TODOS los UUID de B (el peor caso) e intenta leer, modificar, borrar, mover o referenciar
 * esos recursos desde su propia sesión. Resultado esperado: 404 idéntico al de un recurso inexistente
 * y CERO cambios en los datos de B.
 */
describe.skipIf(!hasDb)("aislamiento A/B: carpetas, grafos y panel", () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof register>>;
  let B: Awaited<ReturnType<typeof register>>;
  let b: { folder: string; sub: string; graph: string; graphInFolder: string; trashed: string };
  let a: { folder: string; graph: string };

  /** Instantánea de TODO lo que posee B para detectar cualquier modificación. */
  async function snapshotOfB() {
    const db = t.prisma;
    return JSON.stringify({
      folders: await db.folder.findMany({ where: { ownerId: B.userId }, orderBy: { id: "asc" } }),
      graphs: await db.graph.findMany({ where: { ownerId: B.userId }, orderBy: { id: "asc" } }),
      nodes: await db.graphNode.findMany({ where: { graph: { ownerId: B.userId } }, orderBy: { id: "asc" } }),
      edges: await db.graphEdge.findMany({ where: { graph: { ownerId: B.userId } }, orderBy: { id: "asc" } }),
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    A = await register(t);
    B = await register(t);

    const folder = await mkFolder(B.agent, "Carpeta secreta de B");
    const sub = await mkFolder(B.agent, "Subcarpeta de B", folder);
    const graph = await mkGraph(B.agent, "Grafo secreto de B");
    const graphInFolder = await mkGraph(B.agent, "Grafo en carpeta de B", folder);
    const trashed = await mkGraph(B.agent, "Grafo borrado de B");
    await seedContent(t, graph, 4, 3);
    await seedContent(t, graphInFolder, 2, 1);
    await B.agent.delete(`/api/v1/graphs/${trashed}`);
    b = { folder, sub, graph, graphInFolder, trashed };

    a = { folder: await mkFolder(A.agent, "Carpeta de A"), graph: await mkGraph(A.agent, "Grafo de A") };
  });

  // Todas las operaciones por ID, parametrizadas con el recurso de B.
  const byId = (r: typeof b) =>
    [
      ["GET", `/api/v1/graphs/${r.graph}`, undefined],
      ["PATCH", `/api/v1/graphs/${r.graph}`, { name: "hackeado" }],
      ["DELETE", `/api/v1/graphs/${r.graph}`, undefined],
      ["POST", `/api/v1/graphs/${r.trashed}/restore`, undefined],
      ["DELETE", `/api/v1/graphs/${r.trashed}/permanent`, undefined],
      ["POST", `/api/v1/graphs/${r.graph}/duplicate`, {}],
      ["GET", `/api/v1/folders/${r.folder}`, undefined],
      ["PATCH", `/api/v1/folders/${r.folder}`, { name: "hackeada" }],
      ["PATCH", `/api/v1/folders/${r.folder}`, { parentId: null }],
      ["DELETE", `/api/v1/folders/${r.sub}`, undefined],
      ["DELETE", `/api/v1/folders/${r.folder}?contents=trash`, undefined],
      ["DELETE", `/api/v1/folders/${r.folder}?contents=move_to_parent`, undefined],
    ] as const;

  const call = (agent: typeof A.agent, method: string, path: string, body?: object) =>
    (agent as unknown as Record<string, (p: string) => { send: (b?: object) => Promise<{ status: number; body: Record<string, unknown> }> }>)[
      method.toLowerCase()
    ]!(path).send(body);

  it("A no puede leer, modificar, borrar, restaurar ni duplicar NADA de B por ID: 404 y B queda intacto", async () => {
    const before = await snapshotOfB();
    const count = await t.prisma.graph.count();
    for (const [method, path, body] of byId(b)) {
      const res = await call(A.agent, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    }
    expect(await snapshotOfB()).toBe(before);
    expect(await t.prisma.graph.count()).toBe(count); // el duplicado de A tampoco creó nada
  });

  it("la respuesta ante un recurso ajeno es IDÉNTICA a la de uno inexistente (no revela existencia)", async () => {
    const ghost = { graph: randomUUID(), folder: randomUUID(), sub: randomUUID(), graphInFolder: randomUUID(), trashed: randomUUID() };
    const foreign = byId(b);
    const missing = byId(ghost);
    for (let i = 0; i < foreign.length; i++) {
      const f = await call(A.agent, foreign[i]![0], foreign[i]![1], foreign[i]![2]);
      const m = await call(A.agent, missing[i]![0], missing[i]![1], missing[i]![2]);
      expect(f.status).toBe(m.status);
      expect(errorShape(f.body)).toEqual(errorShape(m.body));
    }
  });

  it("B sigue pudiendo operar con sus recursos tras los intentos de A", async () => {
    for (const [method, path, body] of byId(b)) await call(A.agent, method, path, body);
    expect((await B.agent.get(`/api/v1/graphs/${b.graph}`)).body.graph).toMatchObject({
      name: "Grafo secreto de B",
      nodeCount: 4,
      edgeCount: 3,
    });
    expect((await B.agent.get(`/api/v1/folders/${b.folder}`)).status).toBe(200);
    expect((await B.agent.post(`/api/v1/graphs/${b.trashed}/restore`)).status).toBe(200);
  });

  it("A no puede crear ni mover NADA hacia carpetas de B (se rechaza como si no existieran)", async () => {
    const before = await snapshotOfB();
    const attempts = [
      A.agent.post("/api/v1/folders").send({ name: "intrusa", parentId: b.folder }),
      A.agent.post("/api/v1/graphs").send({ name: "intruso", folderId: b.folder }),
      A.agent.patch(`/api/v1/graphs/${a.graph}`).send({ folderId: b.folder }),
      A.agent.patch(`/api/v1/folders/${a.folder}`).send({ parentId: b.folder }),
      A.agent.patch(`/api/v1/folders/${a.folder}`).send({ parentId: b.sub }),
      A.agent.post(`/api/v1/graphs/${a.graph}/duplicate`).send({ folderId: b.folder }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    expect(await snapshotOfB()).toBe(before);
    // Y lo propio de A no se movió.
    expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: a.graph } })).folderId).toBeNull();
    expect((await t.prisma.folder.findUniqueOrThrow({ where: { id: a.folder } })).parentId).toBeNull();
    expect(await t.prisma.graph.count({ where: { ownerId: A.userId } })).toBe(1);
    expect(await t.prisma.folder.count({ where: { ownerId: A.userId } })).toBe(1);
  });

  it("los listados de A NO contienen nada de B (carpetas, grafos, papelera, búsqueda, filtros)", async () => {
    const folders = await A.agent.get("/api/v1/folders");
    expect(folders.body.items.map((f: { id: string }) => f.id)).toEqual([a.folder]);

    const graphs = await A.agent.get("/api/v1/graphs");
    expect(graphs.body.items.map((g: { id: string }) => g.id)).toEqual([a.graph]);
    expect(graphs.body.total).toBe(1);

    expect((await A.agent.get("/api/v1/graphs?trashed=true")).body.total).toBe(0);
    expect((await A.agent.get("/api/v1/graphs?search=secreto")).body.total).toBe(0);
    expect((await A.agent.get("/api/v1/graphs?search=Carpeta")).body.total).toBe(0);
    expect((await A.agent.get(`/api/v1/graphs?folderId=${b.folder}`)).body.total).toBe(0);
    expect((await A.agent.get(`/api/v1/graphs?folderId=root&pageSize=100`)).body.total).toBe(1);
  });

  it("el panel de A solo cuenta lo suyo", async () => {
    const dashA = await A.agent.get("/api/v1/dashboard");
    expect(dashA.body.counts).toEqual({ graphs: 1, trashedGraphs: 0, folders: 1, nodes: 0, edges: 0, exports: 0 });
    expect(dashA.body.nodesByType).toEqual({});
    expect(dashA.body.recentGraphs.map((g: { id: string }) => g.id)).toEqual([a.graph]);

    const dashB = await B.agent.get("/api/v1/dashboard");
    expect(dashB.body.counts).toEqual({ graphs: 2, trashedGraphs: 1, folders: 2, nodes: 6, edges: 4, exports: 0 });
  });

  it("ningún endpoint acepta el propietario del cliente (ownerId/userId en cuerpo o consulta)", async () => {
    const bodies = [
      A.agent.post("/api/v1/graphs").send({ name: "x", ownerId: B.userId }),
      A.agent.post("/api/v1/folders").send({ name: "x", ownerId: B.userId }),
      A.agent.post("/api/v1/folders").send({ name: "x", userId: B.userId }),
      A.agent.patch(`/api/v1/graphs/${a.graph}`).send({ ownerId: B.userId }),
      A.agent.patch(`/api/v1/folders/${a.folder}`).send({ ownerId: B.userId }),
      A.agent.get(`/api/v1/graphs?ownerId=${B.userId}`),
      A.agent.get(`/api/v1/graphs?userId=${B.userId}`),
    ];
    for (const res of await Promise.all(bodies)) expect(res.status).toBe(400);
    expect(await t.prisma.graph.count({ where: { ownerId: B.userId } })).toBe(3); // sin cambios
    // Y lo creado por A siempre es de A, aunque B exista.
    const ok = await A.agent.post("/api/v1/graphs").send({ name: "mío" });
    expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: ok.body.graph.id } })).ownerId).toBe(A.userId);
  });

  it("un grafo duplicado por A es de A aunque se le pase el ID de un grafo de B como carpeta o similar", async () => {
    const res = await A.agent.post(`/api/v1/graphs/${a.graph}/duplicate`).send({ folderId: b.graph });
    expect(res.status).toBe(404); // un ID de grafo no es una carpeta; y además sería ajeno
  });

  it("cuando A elimina su propia carpeta con contents=trash, los grafos de B no se ven afectados", async () => {
    const before = await snapshotOfB();
    await mkGraph(A.agent, "dentro", a.folder);
    expect((await A.agent.delete(`/api/v1/folders/${a.folder}?contents=trash`)).status).toBe(204);
    expect(await snapshotOfB()).toBe(before);
  });

  it("la sesión de B no sirve para recursos de A (simetría)", async () => {
    expect((await B.agent.get(`/api/v1/graphs/${a.graph}`)).status).toBe(404);
    expect((await B.agent.delete(`/api/v1/folders/${a.folder}`)).status).toBe(404);
    expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: a.graph } })).deletedAt).toBeNull();
  });

  it("los eventos de auditoría de un usuario no incluyen contenido de grafos ni nombres", async () => {
    await A.agent.patch(`/api/v1/graphs/${a.graph}`).send({ name: "NOMBRE-CONFIDENCIAL-123", description: "DESCRIPCION-SECRETA" });
    await mkFolder(A.agent, "CARPETA-CONFIDENCIAL-456");
    const dump = JSON.stringify(await t.prisma.auditLog.findMany());
    expect(dump).not.toMatch(/CONFIDENCIAL|SECRETA/);
    // Sí se auditan las acciones (con IDs), solo que sin contenido: así el filtro anterior no es trivial.
    expect(await t.prisma.auditLog.count({ where: { actorId: A.userId, action: "graph.updated", resourceId: a.graph } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { actorId: A.userId, action: "folder.created" } })).toBe(2); // la de setup + esta
  });
});
