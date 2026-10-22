import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_FOLDERS_PER_USER, MAX_FOLDER_DEPTH } from "../src/common/limits.js";
import { mkFolder, mkGraph, resetDatabase } from "./helpers/domain.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("carpetas (API real + MySQL)", () => {
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

  describe("crear y listar", () => {
    it("crea carpetas anidadas; el listado incluye el recuento de grafos activos y nunca el propietario", async () => {
      const root = await mkFolder(U.agent, "Caso 1");
      const child = await mkFolder(U.agent, "Teléfonos", root);
      await mkGraph(U.agent, "g1", child);
      const trashed = await mkGraph(U.agent, "g2", child);
      await U.agent.delete(`/api/v1/graphs/${trashed}`);

      const res = await U.agent.get("/api/v1/folders");
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      const byId = Object.fromEntries(res.body.items.map((f: { id: string }) => [f.id, f]));
      expect(byId[child]).toMatchObject({ name: "Teléfonos", parentId: root, graphCount: 1 });
      expect(byId[root]).toMatchObject({ parentId: null, graphCount: 0 });
      expect(JSON.stringify(res.body)).not.toMatch(/ownerId/);
    });

    it("el detalle devuelve recuentos de subcarpetas y grafos", async () => {
      const root = await mkFolder(U.agent, "Raíz");
      await mkFolder(U.agent, "Hija", root);
      await mkGraph(U.agent, "g", root);
      const res = await U.agent.get(`/api/v1/folders/${root}`);
      expect(res.status).toBe(200);
      expect(res.body.folder).toMatchObject({ childCount: 1, graphCount: 1 });
    });

    it("normaliza el nombre (recorta espacios) y rechaza vacío, blanco, largo o con caracteres de control", async () => {
      const ok = await U.agent.post("/api/v1/folders").send({ name: "   Con espacios   " });
      expect(ok.body.folder.name).toBe("Con espacios");
      for (const name of ["", "    ", "x".repeat(201), "mal\u0000nombre", "salto\nde linea", 123, null]) {
        const res = await U.agent.post("/api/v1/folders").send({ name });
        expect(res.status, JSON.stringify(name)).toBe(400);
      }
      expect((await U.agent.post("/api/v1/folders").send({})).status).toBe(400);
    });

    it("asignación masiva: ownerId, id, createdAt... se rechazan y no se crea nada", async () => {
      for (const extra of [{ ownerId: "00000000-0000-4000-8000-000000000000" }, { id: "x" }, { createdAt: "2000-01-01" }]) {
        const res = await U.agent.post("/api/v1/folders").send({ name: "Mala", ...extra });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      }
      expect(await t.prisma.folder.count()).toBe(0);
    });

    it("parentId debe ser un UUID v4", async () => {
      for (const parentId of ["abc", 5, "00000000-0000-1000-8000-000000000000"]) {
        expect((await U.agent.post("/api/v1/folders").send({ name: "x", parentId })).status).toBe(400);
      }
      const missing = await U.agent.post("/api/v1/folders").send({ name: "x", parentId: "00000000-0000-4000-8000-000000000000" });
      expect(missing.status).toBe(404);
    });

    it("parámetros de ruta no UUID devuelven 400", async () => {
      expect((await U.agent.get("/api/v1/folders/no-uuid")).status).toBe(400);
      expect((await U.agent.patch("/api/v1/folders/1").send({ name: "x" })).status).toBe(400);
      expect((await U.agent.delete("/api/v1/folders/' OR 1=1--")).status).toBe(400);
    });
  });

  describe("renombrar y mover", () => {
    it("renombra, mueve a otra carpeta y vuelve a la raíz con parentId=null", async () => {
      const a = await mkFolder(U.agent, "A");
      const b = await mkFolder(U.agent, "B");
      const renamed = await U.agent.patch(`/api/v1/folders/${a}`).send({ name: "A2" });
      expect(renamed.body.folder.name).toBe("A2");
      const moved = await U.agent.patch(`/api/v1/folders/${a}`).send({ parentId: b });
      expect(moved.body.folder.parentId).toBe(b);
      const back = await U.agent.patch(`/api/v1/folders/${a}`).send({ parentId: null });
      expect(back.body.folder.parentId).toBeNull();
      expect(back.body.folder.name).toBe("A2");
    });

    it("impide ciclos: dentro de sí misma o de una descendiente", async () => {
      const a = await mkFolder(U.agent, "A");
      const b = await mkFolder(U.agent, "B", a);
      const c = await mkFolder(U.agent, "C", b);
      for (const target of [a, b, c]) {
        const res = await U.agent.patch(`/api/v1/folders/${a}`).send({ parentId: target });
        expect(res.status, `mover A dentro de ${target}`).toBe(409);
        expect(res.body.code).toBe("FOLDER_CYCLE");
      }
      const row = await t.prisma.folder.findUniqueOrThrow({ where: { id: a } });
      expect(row.parentId).toBeNull();
    });

    it("límite de profundidad al crear y al mover un subárbol", async () => {
      let parent: string | undefined;
      const chain: string[] = [];
      for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
        parent = await mkFolder(U.agent, `n${i}`, parent);
        chain.push(parent);
      }
      const tooDeep = await U.agent.post("/api/v1/folders").send({ name: "una más", parentId: chain.at(-1) });
      expect(tooDeep.status).toBe(409);
      expect(tooDeep.body.code).toBe("FOLDER_TOO_DEEP");

      // Un subárbol de 2 niveles no cabe bajo una carpeta de profundidad MAX-1.
      const sub = await mkFolder(U.agent, "sub");
      await mkFolder(U.agent, "sub-hija", sub);
      const move = await U.agent.patch(`/api/v1/folders/${sub}`).send({ parentId: chain[MAX_FOLDER_DEPTH - 2] });
      expect(move.status).toBe(409);
      expect(move.body.code).toBe("FOLDER_TOO_DEEP");
      // Pero sí cabe bajo una de profundidad MAX-2.
      const ok = await U.agent.patch(`/api/v1/folders/${sub}`).send({ parentId: chain[MAX_FOLDER_DEPTH - 3] });
      expect(ok.status).toBe(200);
    });

    it("movimientos opuestos SIMULTÁNEOS (A→B y B→A) nunca crean un ciclo", async () => {
      for (let round = 0; round < 3; round++) {
        const a = await mkFolder(U.agent, `A${round}`);
        const b = await mkFolder(U.agent, `B${round}`);
        const [r1, r2] = await Promise.all([
          U.agent.patch(`/api/v1/folders/${a}`).send({ parentId: b }),
          U.agent.patch(`/api/v1/folders/${b}`).send({ parentId: a }),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        const [fa, fb] = await Promise.all([
          t.prisma.folder.findUniqueOrThrow({ where: { id: a } }),
          t.prisma.folder.findUniqueOrThrow({ where: { id: b } }),
        ]);
        expect(fa.parentId === b && fb.parentId === a).toBe(false);
      }
    });

    it("límite de carpetas por usuario", async () => {
      await t.prisma.folder.createMany({
        data: Array.from({ length: MAX_FOLDERS_PER_USER }, (_, i) => ({ ownerId: U.userId, name: `f${i}` })),
      });
      const res = await U.agent.post("/api/v1/folders").send({ name: "una más" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("FOLDER_LIMIT_REACHED");
    });
  });

  describe("eliminar con política explícita", () => {
    it("una carpeta vacía se elimina", async () => {
      const f = await mkFolder(U.agent, "vacía");
      expect((await U.agent.delete(`/api/v1/folders/${f}`)).status).toBe(204);
      expect((await U.agent.get(`/api/v1/folders/${f}`)).status).toBe(404);
    });

    it("sin política, una carpeta con contenido NO se elimina (409) y todo queda intacto", async () => {
      const f = await mkFolder(U.agent, "con cosas");
      await mkFolder(U.agent, "hija", f);
      const g = await mkGraph(U.agent, "g", f);
      const res = await U.agent.delete(`/api/v1/folders/${f}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("FOLDER_NOT_EMPTY");
      expect(await t.prisma.folder.count()).toBe(2);
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: g } })).folderId).toBe(f);
    });

    it("una carpeta que solo contiene un grafo en la papelera tampoco se considera vacía", async () => {
      const f = await mkFolder(U.agent, "f");
      const g = await mkGraph(U.agent, "g", f);
      await U.agent.delete(`/api/v1/graphs/${g}`);
      expect((await U.agent.delete(`/api/v1/folders/${f}`)).status).toBe(409);
    });

    it("contents=move_to_parent: subcarpetas y grafos suben al padre", async () => {
      const root = await mkFolder(U.agent, "root");
      const mid = await mkFolder(U.agent, "mid", root);
      const leaf = await mkFolder(U.agent, "leaf", mid);
      const g = await mkGraph(U.agent, "g", mid);
      const gt = await mkGraph(U.agent, "gt", mid);
      await U.agent.delete(`/api/v1/graphs/${gt}`);

      expect((await U.agent.delete(`/api/v1/folders/${mid}?contents=move_to_parent`)).status).toBe(204);
      expect((await t.prisma.folder.findUniqueOrThrow({ where: { id: leaf } })).parentId).toBe(root);
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: g } })).folderId).toBe(root);
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: gt } })).folderId).toBe(root);
      expect(await t.prisma.folder.findUnique({ where: { id: mid } })).toBeNull();
    });

    it("contents=move_to_parent desde la raíz deja el contenido en la raíz", async () => {
      const f = await mkFolder(U.agent, "f");
      const child = await mkFolder(U.agent, "c", f);
      const g = await mkGraph(U.agent, "g", f);
      expect((await U.agent.delete(`/api/v1/folders/${f}?contents=move_to_parent`)).status).toBe(204);
      expect((await t.prisma.folder.findUniqueOrThrow({ where: { id: child } })).parentId).toBeNull();
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: g } })).folderId).toBeNull();
    });

    it("contents=trash: grafos activos a la papelera, subárbol eliminado y los grafos quedan restaurables", async () => {
      const root = await mkFolder(U.agent, "root");
      const sub = await mkFolder(U.agent, "sub", root);
      const g1 = await mkGraph(U.agent, "g1", root);
      const g2 = await mkGraph(U.agent, "g2", sub);
      const keep = await mkGraph(U.agent, "ajeno-a-la-carpeta");
      const other = await mkFolder(U.agent, "otra");

      expect((await U.agent.delete(`/api/v1/folders/${root}?contents=trash`)).status).toBe(204);
      expect(await t.prisma.folder.findUnique({ where: { id: root } })).toBeNull();
      expect(await t.prisma.folder.findUnique({ where: { id: sub } })).toBeNull();
      expect(await t.prisma.folder.findUnique({ where: { id: other } })).not.toBeNull();

      for (const id of [g1, g2]) {
        const row = await t.prisma.graph.findUniqueOrThrow({ where: { id } });
        expect(row.deletedAt).not.toBeNull();
        expect(row.folderId).toBeNull();
      }
      expect((await t.prisma.graph.findUniqueOrThrow({ where: { id: keep } })).deletedAt).toBeNull();

      const restored = await U.agent.post(`/api/v1/graphs/${g2}/restore`);
      expect(restored.status).toBe(200);
      expect(restored.body.graph.folderId).toBeNull();
    });

    it("valor de 'contents' no válido → 400 y no se borra nada", async () => {
      const f = await mkFolder(U.agent, "f");
      expect((await U.agent.delete(`/api/v1/folders/${f}?contents=todo`)).status).toBe(400);
      expect((await U.agent.delete(`/api/v1/folders/${f}?otra=1`)).status).toBe(400);
      expect(await t.prisma.folder.count()).toBe(1);
    });
  });
});
