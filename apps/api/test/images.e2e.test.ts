import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { UNUSED_IMAGE_GRACE_MS } from "../src/images/images.service.js";
import { errorShape, mkGraph, resetDatabase } from "./helpers/domain.js";
import { MIME, makeCleanJpeg, makeCleanPng, makeCleanWebp, makePng } from "./helpers/files.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;
type Agent = Awaited<ReturnType<typeof register>>["agent"];

const upload = (agent: Agent, graphId: string, body: Buffer | string, mime: string = MIME.png) =>
  agent.post(`/api/v1/graphs/${graphId}/images`).set("Content-Type", mime).send(body);

describe.skipIf(!hasDb)("imágenes de entidades: subida, lectura, referencias y aislamiento (API real + MySQL)", () => {
  let t: TestApp;
  let U: Awaited<ReturnType<typeof register>>;
  let graphId: string;

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
    graphId = await mkGraph(U.agent, "Caso con imágenes");
  });

  const node = (imageId: string | null, id = randomUUID()) => ({ id, type: "person", label: "Persona", imageId });
  const save = (agent: Agent, graph: string, nodes: unknown[], expectedRevision?: number) =>
    agent.put(`/api/v1/graphs/${graph}/content`).send({ expectedRevision: expectedRevision ?? 1, nodes, edges: [] });

  describe("subida y lectura", () => {
    it.each([
      ["PNG", () => makeCleanPng(24, 24), MIME.png],
      ["JPEG", () => makeCleanJpeg(24, 24), MIME.jpeg],
      ["WebP", () => makeCleanWebp(24, 24), "image/webp"],
    ])("%s: se guarda, devuelve solo metadatos y se lee idéntico, sin permitir que el navegador lo reinterprete", async (_n, make, mime) => {
      const body = make();
      const res = await upload(U.agent, graphId, body, mime);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.image).toMatchObject({ mime, width: 24, height: 24, size: body.length });
      expect(Object.keys(res.body.image).sort()).toEqual(["createdAt", "height", "id", "mime", "size", "width"]); // sin ownerId ni contenido

      const got = await U.agent.get(`/api/v1/graphs/${graphId}/images/${res.body.image.id}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(got.status).toBe(200);
      expect(Buffer.compare(got.body as Buffer, body)).toBe(0);
      expect(got.headers["content-type"]).toBe(mime);
      expect(got.headers["x-content-type-options"]).toBe("nosniff");
      expect(got.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect(got.headers["cache-control"]).toBe("private, no-cache");
      expect(got.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it("la revalidación con ETag responde 304 solo al propietario (la API vuelve a autorizar)", async () => {
      const id = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      const first = await U.agent.get(`/api/v1/graphs/${graphId}/images/${id}`);
      const again = await U.agent.get(`/api/v1/graphs/${graphId}/images/${id}`).set("If-None-Match", first.headers["etag"]!);
      expect(again.status).toBe(304);
      const B = await register(t);
      const foreign = await B.agent.get(`/api/v1/graphs/${graphId}/images/${id}`).set("If-None-Match", first.headers["etag"]!);
      expect(foreign.status).toBe(404);
      expect((await t.raw().get(`/api/v1/graphs/${graphId}/images/${id}`).set("If-None-Match", first.headers["etag"]!)).status).toBe(401);
    });

    it("la misma imagen en el mismo grafo no se guarda dos veces", async () => {
      const body = makeCleanPng(10, 10, "abcd");
      const a = await upload(U.agent, graphId, body);
      const b = await upload(U.agent, graphId, Buffer.from(body));
      expect(b.body.image.id).toBe(a.body.image.id);
      expect(await t.prisma.graphImage.count({ where: { graphId } })).toBe(1);
    });

    it("rechaza lo inválido con el código y estado adecuados y no guarda nada", async () => {
      const cases: Array<[string, Buffer | string, string, number, string]> = [
        ["vacía", Buffer.alloc(0), MIME.png, 400, "EMPTY_FILE"],
        ["HTML disfrazado de PNG", "<html><script>x</script></html>", MIME.png, 415, "UNSUPPORTED_IMAGE"],
        ["PDF", "%PDF-1.7 ....................................", MIME.png, 415, "UNSUPPORTED_IMAGE"],
        ["tipo declarado distinto del real", makeCleanPng(), MIME.jpeg, 415, "MIME_MISMATCH"],
        ["sin tipo declarado", makeCleanPng(), "application/octet-stream", 415, "MIME_MISMATCH"],
        ["JPEG con EXIF (ubicación)", makeCleanJpeg(8, 8, { exif: true }), MIME.jpeg, 415, "IMAGE_HAS_METADATA"],
        ["WebP con EXIF", makeCleanWebp(8, 8, { exif: true }), "image/webp", 415, "IMAGE_HAS_METADATA"],
        ["PNG con texto incrustado", makePng(), MIME.png, 415, "IMAGE_HAS_METADATA"],
        ["demasiado grande en píxeles", makeCleanPng(600, 8), MIME.png, 415, "UNSUPPORTED_IMAGE"],
        ["demasiado pesada", Buffer.concat([makeCleanPng(), Buffer.alloc(300_000, 1)]), MIME.png, 413, "PAYLOAD_TOO_LARGE"],
      ];
      for (const [name, body, mime, status, code] of cases) {
        const res = await upload(U.agent, graphId, body, mime);
        expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(status);
        expect(res.body.code, name).toBe(code);
      }
      expect(await t.prisma.graphImage.count()).toBe(0);
    });

    it("no se puede subir a un grafo en la papelera", async () => {
      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      const res = await upload(U.agent, graphId, makeCleanPng());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_IN_TRASH");
    });
  });

  describe("aislamiento entre cuentas (IDOR)", () => {
    it("B recibe el mismo 404 ante una imagen de A que ante una inexistente, y no puede subir a un grafo de A", async () => {
      const id = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      const B = await register(t);
      const bGraph = await mkGraph(B.agent, "Grafo de B");

      const foreign = await B.agent.get(`/api/v1/graphs/${graphId}/images/${id}`);
      const ghost = await B.agent.get(`/api/v1/graphs/${randomUUID()}/images/${randomUUID()}`);
      expect(foreign.status).toBe(404);
      expect(errorShape(foreign.body)).toEqual(errorShape(ghost.body));

      // Ni siquiera con un grafo PROPIO de B se alcanza la imagen de A, ni con su identificador de grafo correcto.
      expect((await B.agent.get(`/api/v1/graphs/${bGraph}/images/${id}`)).status).toBe(404);

      const attack = await upload(B.agent, graphId, makeCleanPng());
      expect(attack.status).toBe(404);
      expect(errorShape(attack.body)).toEqual(errorShape((await upload(B.agent, randomUUID(), makeCleanPng())).body));
      expect(await t.prisma.graphImage.count({ where: { ownerId: B.userId } })).toBe(0);
    });

    it("una imagen de un grafo de la MISMA cuenta no se alcanza con el identificador de otro grafo", async () => {
      const other = await mkGraph(U.agent, "Otro grafo");
      const id = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      expect((await U.agent.get(`/api/v1/graphs/${other}/images/${id}`)).status).toBe(404);
    });

    it("sin sesión: 401 en subida y lectura", async () => {
      expect((await t.raw().post(`/api/v1/graphs/${graphId}/images`).set("Origin", "http://localhost:5173").set("Content-Type", MIME.png).send(makeCleanPng())).status).toBe(401);
      expect((await t.raw().get(`/api/v1/graphs/${graphId}/images/${randomUUID()}`)).status).toBe(401);
    });

    it("no se puede REFERENCIAR (en el contenido de un grafo) la imagen de otra cuenta ni la de otro grafo; el error es genérico", async () => {
      const mine = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      const B = await register(t);
      const bGraph = await mkGraph(B.agent, "Grafo de B");
      const theirs = (await upload(B.agent, bGraph, makeCleanPng())).body.image.id as string;
      const otherOfMine = await mkGraph(U.agent, "Segundo grafo");

      const stolen = await save(U.agent, graphId, [node(theirs)]);
      const ghost = await save(U.agent, graphId, [node(randomUUID())]);
      expect(stolen.status).toBe(400);
      expect(errorShape(stolen.body)).toEqual(errorShape(ghost.body));
      expect(JSON.stringify(stolen.body)).not.toContain(theirs);

      expect((await save(U.agent, otherOfMine, [node(mine)])).status, "imagen de otro grafo propio").toBe(400);
      expect((await save(U.agent, graphId, [node("no-es-un-uuid")])).status).toBe(400);
      expect((await save(U.agent, graphId, [node(mine)])).status).toBe(200);
      expect((await U.agent.get(`/api/v1/graphs/${graphId}/content`)).body.nodes[0].imageId).toBe(mine);
    });
  });

  describe("ciclo de vida", () => {
    it("el contenido guardado conserva y devuelve imageId; una entidad sin imagen devuelve null", async () => {
      const img = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      const withImg = node(img);
      const plain = node(null);
      expect((await save(U.agent, graphId, [withImg, plain])).status).toBe(200);
      const nodes = (await U.agent.get(`/api/v1/graphs/${graphId}/content`)).body.nodes as Array<{ id: string; imageId: string | null }>;
      expect(nodes.find((n) => n.id === withImg.id)?.imageId).toBe(img);
      expect(nodes.find((n) => n.id === plain.id)?.imageId).toBeNull();
      // Quitar la imagen de la entidad es un cambio de contenido que se guarda (revisión 2 → 3).
      expect((await save(U.agent, graphId, [{ ...withImg, imageId: null }, plain], 2)).status).toBe(200);
      expect((await U.agent.get(`/api/v1/graphs/${graphId}/content`)).body.nodes.every((n: { imageId: string | null }) => n.imageId === null)).toBe(true);
    });

    it("al guardar se retiran las imágenes SIN USO de más de 24 h; las usadas y las recientes se conservan", async () => {
      const used = (await upload(U.agent, graphId, makeCleanPng(8, 8, "0001"))).body.image.id as string;
      const oldUnused = (await upload(U.agent, graphId, makeCleanPng(8, 8, "0002"))).body.image.id as string;
      const recentUnused = (await upload(U.agent, graphId, makeCleanPng(8, 8, "0003"))).body.image.id as string;
      const oldUsedLater = (await upload(U.agent, graphId, makeCleanPng(8, 8, "0004"))).body.image.id as string;
      const old = new Date(Date.now() - UNUSED_IMAGE_GRACE_MS - 60_000);
      await t.prisma.graphImage.updateMany({ where: { id: { in: [oldUnused, used, oldUsedLater] } }, data: { createdAt: old } });

      expect((await save(U.agent, graphId, [node(used), node(oldUsedLater)])).status).toBe(200);
      const left = (await t.prisma.graphImage.findMany({ where: { graphId }, select: { id: true } })).map((i) => i.id).sort();
      expect(left).toEqual([used, recentUnused, oldUsedLater].sort());
      expect((await U.agent.get(`/api/v1/graphs/${graphId}/images/${oldUnused}`)).status).toBe(404);
    });

    it("borrar la entidad deja la imagen sin uso (se retira pasado el plazo) y borrar la imagen con la BD deja la entidad sin imagen, no rota", async () => {
      const img = (await upload(U.agent, graphId, makeCleanPng())).body.image.id as string;
      const n = node(img);
      await save(U.agent, graphId, [n]);
      await t.prisma.graphImage.delete({ where: { id: img } }); // ON DELETE SET NULL
      const content = (await U.agent.get(`/api/v1/graphs/${graphId}/content`)).body;
      expect(content.nodes).toHaveLength(1);
      expect(content.nodes[0].imageId).toBeNull();
    });

    it("duplicar un grafo copia las imágenes con identificadores nuevos; el borrado definitivo del original no afecta a la copia", async () => {
      const img = (await upload(U.agent, graphId, makeCleanPng(12, 12, "beef"))).body.image.id as string;
      await save(U.agent, graphId, [node(img)]);
      const copy = (await U.agent.post(`/api/v1/graphs/${graphId}/duplicate`).send({})).body.graph.id as string;

      const copied = (await U.agent.get(`/api/v1/graphs/${copy}/content`)).body.nodes[0].imageId as string;
      expect(copied).toBeTruthy();
      expect(copied).not.toBe(img);
      expect((await U.agent.get(`/api/v1/graphs/${copy}/images/${copied}`)).status).toBe(200);
      expect((await U.agent.get(`/api/v1/graphs/${copy}/images/${img}`)).status).toBe(404);

      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      expect((await U.agent.delete(`/api/v1/graphs/${graphId}/permanent`)).status).toBe(204);
      expect(await t.prisma.graphImage.count({ where: { graphId } })).toBe(0);
      expect((await U.agent.get(`/api/v1/graphs/${copy}/images/${copied}`)).status).toBe(200);
    });

    it("borrar la cuenta (cascada de la BD) no deja imágenes huérfanas", async () => {
      await upload(U.agent, graphId, makeCleanPng());
      await t.prisma.user.delete({ where: { id: U.userId } });
      expect(await t.prisma.graphImage.count()).toBe(0);
    });
  });
});
