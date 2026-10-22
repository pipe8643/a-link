import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { errorShape, mkGraph, resetDatabase } from "./helpers/domain.js";
import { TEST_ORIGIN, type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

type Agent = Awaited<ReturnType<typeof register>>["agent"];

const node = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: "person",
  label: "Ana",
  description: "",
  notes: "",
  tags: [] as string[],
  metadata: {},
  imageId: null as string | null,
  positionX: null,
  positionY: null,
  ...over,
});
const edge = (sourceId: string, targetId: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  sourceId,
  targetId,
  relationshipType: "association",
  label: "",
  metadata: { direction: "forward", evidenceClass: "hypothesis" },
  ...over,
});

const put = (agent: Agent, graphId: string, body: unknown) => agent.put(`/api/v1/graphs/${graphId}/content`).send(body as object);
const get = (agent: Agent, graphId: string) => agent.get(`/api/v1/graphs/${graphId}/content`);

describe.skipIf(!hasDb)("contenido del grafo: guardado, concurrencia y aislamiento (API real + MySQL)", () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof register>>;
  let B: Awaited<ReturnType<typeof register>>;

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
  });

  describe("lectura y guardado", () => {
    it("un grafo nuevo está vacío y en la revisión 1", async () => {
      const id = await mkGraph(A.agent, "g");
      const res = await get(A.agent, id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ revision: 1, graphDataVersion: 1, nodes: [], edges: [] });
    });

    it("guarda y devuelve el mismo contenido (ida y vuelta) y sube la revisión", async () => {
      const id = await mkGraph(A.agent, "g");
      const n1 = node({ label: "Ana", tags: ["clave", "viaje"], notes: "línea 1\nlínea 2", positionX: 10.5, positionY: -20 });
      const n2 = node({ type: "phone", label: "Móvil", metadata: { number: "+34 600 000 000" } });
      const e1 = edge(n1.id, n2.id, { label: "usa", metadata: { direction: "both", evidenceClass: "recorded", confidence: 80, startDate: "2024-01-02" } });

      const saved = await put(A.agent, id, { expectedRevision: 1, nodes: [n1, n2], edges: [e1] });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ revision: 2, nodeCount: 2, edgeCount: 1 });

      const read = await get(A.agent, id);
      expect(read.body.revision).toBe(2);
      expect(read.body.nodes).toHaveLength(2);
      const byId = new Map<string, Record<string, unknown>>(read.body.nodes.map((n: { id: string }) => [n.id, n]));
      expect(byId.get(n1.id)).toEqual(n1);
      expect(byId.get(n2.id)).toEqual(n2);
      expect(read.body.edges).toEqual([e1]);

      const summary = await A.agent.get(`/api/v1/graphs/${id}`);
      expect(summary.body.graph).toMatchObject({ revision: 2, nodeCount: 2, edgeCount: 1 });
    });

    it("solo escribe las diferencias: lo que no cambió no se toca; borrar una entidad borra sus relaciones", async () => {
      const id = await mkGraph(A.agent, "g");
      const a = node({ label: "A" });
      const b = node({ label: "B" });
      const c = node({ label: "C" });
      const ab = edge(a.id, b.id);
      const bc = edge(b.id, c.id);
      await put(A.agent, id, { expectedRevision: 1, nodes: [a, b, c], edges: [ab, bc] });
      const before = await t.prisma.graphNode.findUniqueOrThrow({ where: { id: a.id } });
      await new Promise((r) => setTimeout(r, 15));

      // A sin cambios; B renombrado; C eliminado (y con él la relación B→C); D nuevo.
      const d = node({ label: "D" });
      const res = await put(A.agent, id, { expectedRevision: 2, nodes: [a, { ...b, label: "B2" }, d], edges: [ab] });
      expect(res.status).toBe(200);
      expect(res.body.changes).toEqual({ nodesAdded: 1, nodesChanged: 1, nodesRemoved: 1, edgesAdded: 0, edgesChanged: 0, edgesRemoved: 1 });

      const after = await t.prisma.graphNode.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      const read = await get(A.agent, id);
      expect(read.body.nodes.map((n: { label: string }) => n.label).sort()).toEqual(["A", "B2", "D"]);
      expect(read.body.edges.map((e: { id: string }) => e.id)).toEqual([ab.id]);
    });

    it("guardar lo mismo no produce cambios (el JSON de MySQL se compara de forma canónica)", async () => {
      const id = await mkGraph(A.agent, "g");
      const a = node({ tags: ["x"], metadata: { fullName: "Ana Pérez", internalId: "123" } });
      const b = node({ type: "phone" });
      const e = edge(a.id, b.id, { metadata: { evidenceClass: "observation", direction: "none", description: "d" } });
      const first = await put(A.agent, id, { expectedRevision: 1, nodes: [a, b], edges: [e] });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const res = await put(A.agent, id, { expectedRevision: 2, nodes: [a, b], edges: [e] });
      expect(res.body.changes).toEqual({ nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, edgesAdded: 0, edgesChanged: 0, edgesRemoved: 0 });
      expect(res.body.revision).toBe(3);
    });

    it("vaciar el grafo es válido", async () => {
      const id = await mkGraph(A.agent, "g");
      const a = node();
      await put(A.agent, id, { expectedRevision: 1, nodes: [a], edges: [] });
      const res = await put(A.agent, id, { expectedRevision: 2, nodes: [], edges: [] });
      expect(res.status).toBe(200);
      expect((await get(A.agent, id)).body.nodes).toEqual([]);
    });
  });

  describe("concurrencia optimista", () => {
    it("una revisión antigua da 409 con la revisión vigente y NO modifica nada", async () => {
      const id = await mkGraph(A.agent, "g");
      const a = node({ label: "original" });
      await put(A.agent, id, { expectedRevision: 1, nodes: [a], edges: [] });

      const stale = await put(A.agent, id, { expectedRevision: 1, nodes: [{ ...a, label: "pisado" }], edges: [] });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: "REVISION_CONFLICT", details: { currentRevision: 2 } });
      const row = await t.prisma.graphNode.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.label).toBe("original");
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id } })).revision).toBe(2);
    });

    it("una revisión futura también se rechaza", async () => {
      const id = await mkGraph(A.agent, "g");
      expect((await put(A.agent, id, { expectedRevision: 9, nodes: [], edges: [] })).status).toBe(409);
    });

    it("dos guardados simultáneos con la misma revisión: uno gana y el otro recibe 409 (sin mezcla de datos)", async () => {
      const id = await mkGraph(A.agent, "g");
      const attempts = Array.from({ length: 6 }, (_, i) => put(A.agent, id, { expectedRevision: 1, nodes: [node({ label: `v${i}` })], edges: [] }));
      const results = await Promise.all(attempts);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 409, 409, 409, 409, 409]);
      const read = await get(A.agent, id);
      expect(read.body.revision).toBe(2);
      expect(read.body.nodes).toHaveLength(1); // el contenido es el de UN guardado completo
    });
  });

  describe("validación (el servidor no confía en el cliente)", () => {
    const sentinel = "VALOR-SECRETO-NO-DEBE-ECOAR";

    it("rechaza cuerpos mal formados con 400 y sin devolver los valores enviados", async () => {
      const id = await mkGraph(A.agent, "g");
      const a = node();
      const b = node();
      const bad: Array<[string, unknown]> = [
        ["sin expectedRevision", { nodes: [], edges: [] }],
        ["expectedRevision 0", { expectedRevision: 0, nodes: [], edges: [] }],
        ["expectedRevision texto", { expectedRevision: "1", nodes: [], edges: [] }],
        ["campo extra en la raíz (ownerId)", { expectedRevision: 1, nodes: [], edges: [], ownerId: randomUUID() }],
        ["campo extra en la raíz (revision)", { expectedRevision: 1, nodes: [], edges: [], revision: 5 }],
        ["campo extra en un nodo", { expectedRevision: 1, nodes: [{ ...a, graphId: randomUUID() }], edges: [] }],
        ["tipo de entidad desconocido", { expectedRevision: 1, nodes: [{ ...a, type: "dragon" }], edges: [] }],
        ["id que no es UUID", { expectedRevision: 1, nodes: [{ ...a, id: "no-uuid" }], edges: [] }],
        ["ids de nodo repetidos", { expectedRevision: 1, nodes: [a, { ...b, id: a.id }], edges: [] }],
        ["relación a un nodo inexistente", { expectedRevision: 1, nodes: [a], edges: [edge(a.id, randomUUID())] }],
        ["relación de una entidad consigo misma", { expectedRevision: 1, nodes: [a], edges: [edge(a.id, a.id)] }],
        ["tipo de relación desconocido", { expectedRevision: 1, nodes: [a, b], edges: [edge(a.id, b.id, { relationshipType: "x" })] }],
        ["metadatos de relación con clave desconocida", { expectedRevision: 1, nodes: [a, b], edges: [edge(a.id, b.id, { metadata: { direction: "none", evidenceClass: "hypothesis", admin: true } })] }],
        ["metadato no permitido para el tipo", { expectedRevision: 1, nodes: [{ ...a, metadata: { plate: "1234" } }], edges: [] }],
        ["coordenada no finita", { expectedRevision: 1, nodes: [{ ...a, positionX: 1e12, positionY: 0 }], edges: [] }],
        ["más de 20 etiquetas", { expectedRevision: 1, nodes: [{ ...a, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }], edges: [] }],
        ["control en el nombre", { expectedRevision: 1, nodes: [{ ...a, label: `${sentinel}\u0000` }], edges: [] }],
        ["nombre vacío", { expectedRevision: 1, nodes: [{ ...a, label: "   " }], edges: [] }],
        ["cuerpo que no es objeto", [1, 2, 3]],
        ["nodes no es lista", { expectedRevision: 1, nodes: "x", edges: [] }],
      ];
      for (const [name, body] of bad) {
        const res = await put(A.agent, id, body);
        expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.code, name).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.body), name).not.toContain(sentinel);
      }
      // Ninguna petición inválida cambió nada (ni la revisión).
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id } })).revision).toBe(1);
      expect(await t.prisma.graphNode.count()).toBe(0);
    });

    it("aplica los límites del modelo (5 000 entidades) y el cuerpo siempre es atómico", async () => {
      const id = await mkGraph(A.agent, "g");
      const many = Array.from({ length: 5001 }, () => node());
      const res = await put(A.agent, id, { expectedRevision: 1, nodes: many, edges: [] });
      expect(res.status).toBe(400);
      expect(await t.prisma.graphNode.count()).toBe(0);
    });

    it("un fallo a mitad de guardado deshace TODO (transaccional): ni revisión ni datos parciales", async () => {
      const id = await mkGraph(A.agent, "g");
      const other = await mkGraph(A.agent, "otro");
      const reused = node();
      await put(A.agent, other, { expectedRevision: 1, nodes: [reused], edges: [] });

      // El segundo nodo es válido, pero el primero ya existe en otro grafo → error y nada se escribe.
      const res = await put(A.agent, id, { expectedRevision: 1, nodes: [node({ label: "nuevo" }), reused], edges: [] });
      expect(res.status).toBe(400);
      expect(await t.prisma.graphNode.count({ where: { graphId: id } })).toBe(0);
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id } })).revision).toBe(1);
    });
  });

  describe("aislamiento entre cuentas (IDOR)", () => {
    it("B no puede leer ni escribir el contenido de A; la respuesta es idéntica a la de un grafo inexistente", async () => {
      const id = await mkGraph(A.agent, "de A");
      const a = node({ label: "secreto de A" });
      await put(A.agent, id, { expectedRevision: 1, nodes: [a], edges: [] });

      const ghost = randomUUID();
      const foreignGet = await get(B.agent, id);
      const ghostGet = await get(B.agent, ghost);
      expect(foreignGet.status).toBe(404);
      expect(errorShape(foreignGet.body)).toEqual(errorShape(ghostGet.body));
      expect(JSON.stringify(foreignGet.body)).not.toContain("secreto");

      const foreignPut = await put(B.agent, id, { expectedRevision: 2, nodes: [], edges: [] });
      const ghostPut = await put(B.agent, ghost, { expectedRevision: 2, nodes: [], edges: [] });
      expect(foreignPut.status).toBe(404);
      expect(errorShape(foreignPut.body)).toEqual(errorShape(ghostPut.body));

      // Ni siquiera con una revisión equivocada se distingue «ajeno» de «inexistente» (no hay 409 filtrado).
      const foreignStale = await put(B.agent, id, { expectedRevision: 1, nodes: [], edges: [] });
      expect(errorShape(foreignStale.body)).toEqual(errorShape(ghostPut.body));

      // El contenido de A está intacto.
      const read = await get(A.agent, id);
      expect(read.body.nodes).toHaveLength(1);
      expect(read.body.revision).toBe(2);
    });

    it("B no puede reutilizar identificadores de A (ni se le revela de quién son)", async () => {
      const idA = await mkGraph(A.agent, "de A");
      const idB = await mkGraph(B.agent, "de B");
      const a = node({ label: "de A" });
      await put(A.agent, idA, { expectedRevision: 1, nodes: [a], edges: [] });

      const hijack = await put(B.agent, idB, { expectedRevision: 1, nodes: [{ ...a, label: "robado" }], edges: [] });
      const fresh = await put(B.agent, idB, { expectedRevision: 1, nodes: [node(), { ...node(), type: "nope" }], edges: [] });
      expect(hijack.status).toBe(400);
      expect(hijack.body.code).toBe("VALIDATION_ERROR");
      expect(hijack.body.message).toBe(fresh.body.message); // mismo mensaje genérico
      expect(JSON.stringify(hijack.body)).not.toContain(idA);
      expect(await t.prisma.graphNode.count({ where: { graphId: idB } })).toBe(0);
      expect((await t.prisma.graphNode.findUniqueOrThrow({ where: { id: a.id } })).label).toBe("de A");
    });

    it("una relación no puede apuntar a una entidad de otro grafo (tampoco de la misma cuenta)", async () => {
      const g1 = await mkGraph(A.agent, "g1");
      const g2 = await mkGraph(A.agent, "g2");
      const n1 = node();
      await put(A.agent, g1, { expectedRevision: 1, nodes: [n1], edges: [] });
      const n2 = node();
      const res = await put(A.agent, g2, { expectedRevision: 1, nodes: [n2], edges: [edge(n2.id, n1.id)] });
      expect(res.status).toBe(400);
      expect(await t.prisma.graphEdge.count()).toBe(0);
    });

    it("el propietario sale de la sesión: enviar ownerId no cambia nada y se rechaza", async () => {
      const id = await mkGraph(A.agent, "g");
      const res = await put(B.agent, id, { expectedRevision: 1, ownerId: B.userId, nodes: [], edges: [] });
      expect(res.status).toBe(400); // la validación va antes que el acceso, pero no hay efecto alguno
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id } })).ownerId).toBe(A.userId);
    });

    it("sin sesión: 401 en lectura y escritura", async () => {
      const id = await mkGraph(A.agent, "g");
      expect((await t.agent().get(`/api/v1/graphs/${id}/content`)).status).toBe(401);
      expect((await t.agent().put(`/api/v1/graphs/${id}/content`).send({ expectedRevision: 1, nodes: [], edges: [] })).status).toBe(401);
    });

    it("la escritura exige el origen de la aplicación (CSRF)", async () => {
      const id = await mkGraph(A.agent, "g");
      const res = await A.agent.put(`/api/v1/graphs/${id}/content`).set("Origin", "https://evil.example").send({ expectedRevision: 1, nodes: [], edges: [] });
      expect(res.status).toBe(403);
    });
  });

  describe("papelera y tamaño", () => {
    it("un grafo en la papelera no se lee ni se escribe hasta restaurarlo", async () => {
      const id = await mkGraph(A.agent, "g");
      await A.agent.delete(`/api/v1/graphs/${id}`);
      expect((await get(A.agent, id)).body.code).toBe("GRAPH_IN_TRASH");
      const res = await put(A.agent, id, { expectedRevision: 1, nodes: [node()], edges: [] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_IN_TRASH");
      await A.agent.post(`/api/v1/graphs/${id}/restore`);
      expect((await put(A.agent, id, { expectedRevision: 1, nodes: [node()], edges: [] })).status).toBe(200);
    });

    it("acepta un guardado de más de 2 MB con sesión (límite propio) y rechaza más de 16 MB", async () => {
      const id = await mkGraph(A.agent, "g");
      const big = Array.from({ length: 1500 }, (_, i) => node({ label: `n${i}`, notes: "x".repeat(2000) })); // ≈ 3 MB
      const ok = await put(A.agent, id, { expectedRevision: 1, nodes: big, edges: [] });
      expect(ok.status, JSON.stringify(ok.body).slice(0, 200)).toBe(200);

      const huge = { expectedRevision: 2, nodes: [], edges: [], pad: "x".repeat(17 * 1024 * 1024) };
      const res = await put(A.agent, id, huge);
      expect(res.status).toBe(413);
    });

    it("sin cookie de sesión NO se acepta el límite grande (413 a partir de 2 MB)", async () => {
      const id = await mkGraph(A.agent, "g");
      const res = await t.agent().put(`/api/v1/graphs/${id}/content`).send({ expectedRevision: 1, nodes: [], edges: [], pad: "x".repeat(3 * 1024 * 1024) });
      expect(res.status).toBe(413);
    });

    it("una cookie de sesión falsa (aunque tenga forma válida) no habilita el parser grande", async () => {
      const id = await mkGraph(A.agent, "g");
      const res = await t
        .raw()
        .put(`/api/v1/graphs/${id}/content`)
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", `${t.config.sessionCookieName}=${"a".repeat(43)}`)
        .send({ expectedRevision: 1, nodes: [], edges: [], pad: "x".repeat(3 * 1024 * 1024) });
      expect(res.status).toBe(413);
    });

    it("el resto de rutas conserva el límite de 2 MB", async () => {
      const res = await A.agent.post("/api/v1/graphs").send({ name: "x", description: "x".repeat(3 * 1024 * 1024) });
      expect(res.status).toBe(413);
    });

    it("un grafo en el máximo (5 000 entidades y 20 000 relaciones) se guarda, se relee y se vuelve a guardar sin cambios", async () => {
      const id = await mkGraph(A.agent, "grande");
      const nodes = Array.from({ length: 5000 }, (_, i) => node({ label: `Entidad ${i}`, positionX: i, positionY: -i, tags: [`t${i % 7}`] }));
      const edges = Array.from({ length: 20000 }, (_, i) => edge(nodes[i % 5000]!.id, nodes[(i * 7 + 1) % 5000 === i % 5000 ? (i + 1) % 5000 : (i * 7 + 1) % 5000]!.id));
      const started = Date.now();
      const first = await put(A.agent, id, { expectedRevision: 1, nodes, edges });
      expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
      expect(Date.now() - started).toBeLessThan(40_000);

      const read = await get(A.agent, id);
      expect(read.body.nodes).toHaveLength(5000);
      expect(read.body.edges).toHaveLength(20000);

      const again = await put(A.agent, id, { expectedRevision: 2, nodes: read.body.nodes, edges: read.body.edges });
      expect(again.status).toBe(200);
      expect(again.body.changes).toEqual({ nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, edgesAdded: 0, edgesChanged: 0, edgesRemoved: 0 });
    }, 120_000);
  });

  it("duplicar un grafo copia el contenido guardado con identificadores nuevos", async () => {
    const id = await mkGraph(A.agent, "g");
    const a = node({ label: "A" });
    const b = node({ label: "B" });
    await put(A.agent, id, { expectedRevision: 1, nodes: [a, b], edges: [edge(a.id, b.id)] });
    const copy = (await A.agent.post(`/api/v1/graphs/${id}/duplicate`).send({})).body.graph;
    const read = await get(A.agent, copy.id);
    expect(read.body.nodes.map((n: { label: string }) => n.label).sort()).toEqual(["A", "B"]);
    expect(read.body.nodes.map((n: { id: string }) => n.id)).not.toContain(a.id);
    expect(read.body.edges).toHaveLength(1);
  });
});
