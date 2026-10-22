import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MAX_ACTIVE_SHARES_PER_GRAPH, hashToken } from "../src/shares/shares.service.js";
import { errorShape, mkGraph, resetDatabase } from "./helpers/domain.js";
import { MIME, makeCleanPng } from "./helpers/files.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;
type Agent = Awaited<ReturnType<typeof register>>["agent"];

describe.skipIf(!hasDb)("enlaces de solo lectura: creación, vista pública, caducidad y revocación (API real + MySQL)", () => {
  let t: TestApp;
  let U: Awaited<ReturnType<typeof register>>;
  let graphId: string;
  let imageId: string;
  let strayImageId: string;

  const shared = (token: string | null, path = "graph") => {
    const r = t.raw().get(`/api/v1/shared/${path}`);
    return token === null ? r : r.set("X-Share-Token", token);
  };
  const createShare = (agent: Agent, graph: string, days: number | string = 7) => agent.post(`/api/v1/graphs/${graph}/shares`).send({ days });

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
    graphId = await mkGraph(U.agent, "Caso compartido");
    imageId = (await U.agent.post(`/api/v1/graphs/${graphId}/images`).set("Content-Type", MIME.png).send(makeCleanPng(8, 8, "a1"))).body.image.id;
    strayImageId = (await U.agent.post(`/api/v1/graphs/${graphId}/images`).set("Content-Type", MIME.png).send(makeCleanPng(8, 8, "b2"))).body.image.id;
    const a = randomUUID();
    const b = randomUUID();
    const res = await U.agent.put(`/api/v1/graphs/${graphId}/content`).send({
      expectedRevision: 1,
      nodes: [
        { id: a, type: "person", label: "Ana Demo", notes: "NOTA-PRIVADA-123", description: "DESCNODO-PRIVADA-1", imageId, metadata: { alias: "Anita", internalId: "ID-SENSIBLE-9", observations: "OBS-PRIVADA-555" } },
        { id: b, type: "organization", label: "Empresa Demo" },
      ],
      edges: [{ id: randomUUID(), sourceId: a, targetId: b, label: "Socia", relationshipType: "association", metadata: { direction: "forward", evidenceClass: "recorded", description: "DESC-PRIVADA-456", source: "FUENTE-PRIVADA-789", confidence: 80 } }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("crea un enlace: el token (43 caracteres) se entrega una sola vez y en la BD solo queda su hash", async () => {
    const res = await createShare(U.agent, graphId, 7);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const token = res.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(res.body.share).sort()).toEqual(["createdAt", "expiresAt", "id", "lastViewedAt", "revokedAt", "status", "viewCount"]);

    const row = await t.prisma.shareLink.findFirstOrThrow({ where: { graphId } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);

    const list = await U.agent.get(`/api/v1/graphs/${graphId}/shares`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|ownerId/);
    expect(list.body.items).toHaveLength(1);
  });

  it("solo admite 1, 7 o 30 días y un máximo de enlaces activos por grafo", async () => {
    for (const bad of [0, 2, 365, -1, 1.5, null]) {
      expect((await createShare(U.agent, graphId, bad as number)).status, `days=${String(bad)}`).toBe(400);
    }
    expect((await U.agent.post(`/api/v1/graphs/${graphId}/shares`).send({})).status).toBe(400);
    for (let i = 0; i < MAX_ACTIVE_SHARES_PER_GRAPH; i++) expect((await createShare(U.agent, graphId, 1)).status).toBe(201);
    const over = await createShare(U.agent, graphId, 1);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("SHARE_LIMIT_REACHED");
  });

  describe("vista pública con el token en la cabecera", () => {
    it("devuelve el grafo SIN notas, SIN metadatos sensibles y SIN descripción/fuente de las relaciones, con cabeceras de no indexación y sin caché", async () => {
      const token = (await createShare(U.agent, graphId)).body.token as string;
      const res = await shared(token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of ["NOTA-PRIVADA-123", "DESCNODO-PRIVADA-1", "OBS-PRIVADA-555", "DESC-PRIVADA-456", "FUENTE-PRIVADA-789", "ID-SENSIBLE-9", "ownerId", "tokenHash", U.userId]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(res.body.name).toBe("Caso compartido");
      expect(res.body.nodes.map((n: { label: string }) => n.label).sort()).toEqual(["Ana Demo", "Empresa Demo"]);
      expect(res.body.nodes.find((n: { label: string }) => n.label === "Ana Demo").imageId).toBe(imageId);
      expect(res.body.nodes.find((n: { label: string }) => n.label === "Ana Demo").metadata).toEqual({ alias: "Anita" });
      expect(Object.keys(res.body.edges[0].metadata).sort()).toEqual(["direction", "evidenceClass"]);
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(res.headers["cache-control"]).toMatch(/no-store/);
    });

    it("cuenta las consultas del enlace", async () => {
      const created = await createShare(U.agent, graphId);
      await shared(created.body.token);
      await shared(created.body.token);
      const list = await U.agent.get(`/api/v1/graphs/${graphId}/shares`);
      expect(list.body.items[0].viewCount).toBe(2);
      expect(list.body.items[0].lastViewedAt).toBeTruthy();
    });

    it("el token solo se acepta por cabecera: en la URL o el cuerpo no sirve", async () => {
      const token = (await createShare(U.agent, graphId)).body.token as string;
      expect((await t.raw().get(`/api/v1/shared/graph?token=${token}`)).status).toBe(404);
      expect((await t.raw().get(`/api/v1/shared/graph`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
    });

    it("todos los fallos son el MISMO 404: sin token, mal formado, inventado, caducado, revocado, grafo en papelera", async () => {
      const ok = await createShare(U.agent, graphId);
      const expired = await createShare(U.agent, graphId);
      const revoked = await createShare(U.agent, graphId);
      await t.prisma.shareLink.updateMany({ where: { tokenHash: hashToken(expired.body.token) }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 1000) } });
      expect((await U.agent.delete(`/api/v1/graphs/${graphId}/shares/${revoked.body.share.id}`)).status).toBe(204);

      const attempts = [null, "", "corto", "x".repeat(43), "x".repeat(44), "../../etc/passwd", "%00".repeat(15), expired.body.token, revoked.body.token];
      const shapes = [];
      for (const a of attempts) {
        const r = await shared(a);
        expect(r.status, String(a)).toBe(404);
        shapes.push(JSON.stringify(errorShape(r.body)));
      }
      expect(new Set(shapes).size).toBe(1);

      expect((await shared(ok.body.token)).status).toBe(200);
      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      expect((await shared(ok.body.token)).status).toBe(404); // grafo en papelera
      await U.agent.post(`/api/v1/graphs/${graphId}/restore`);
      expect((await shared(ok.body.token)).status).toBe(200); // restaurado
    });

    it("al eliminar definitivamente el grafo, el enlace deja de existir", async () => {
      const token = (await createShare(U.agent, graphId)).body.token as string;
      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      await U.agent.delete(`/api/v1/graphs/${graphId}/permanent`);
      expect((await shared(token)).status).toBe(404);
      expect(await t.prisma.shareLink.count()).toBe(0);
    });
  });

  describe("imágenes servidas por el enlace", () => {
    it("solo las imágenes usadas por el grafo compartido, y con las cabeceras defensivas", async () => {
      const token = (await createShare(U.agent, graphId)).body.token as string;
      const ok = await shared(token, `images/${imageId}`);
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toBe(MIME.png);
      expect(ok.headers["x-content-type-options"]).toBe("nosniff");
      expect(ok.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");

      // Subida pero sin uso en el grafo: no se sirve. Inexistente: igual.
      expect((await shared(token, `images/${strayImageId}`)).status).toBe(404);
      expect((await shared(token, `images/${randomUUID()}`)).status).toBe(404);
      expect((await shared(null, `images/${imageId}`)).status).toBe(404);
    });

    it("una imagen de OTRO grafo, aunque sea de la misma cuenta, no se sirve con un token de este grafo", async () => {
      const other = await mkGraph(U.agent, "Otro");
      const otherImg = (await U.agent.post(`/api/v1/graphs/${other}/images`).set("Content-Type", MIME.png).send(makeCleanPng(8, 8, "c3"))).body.image.id as string;
      await U.agent.put(`/api/v1/graphs/${other}/content`).send({ expectedRevision: 1, nodes: [{ id: randomUUID(), type: "person", label: "X", imageId: otherImg }], edges: [] });
      const token = (await createShare(U.agent, graphId)).body.token as string;
      expect((await shared(token, `images/${otherImg}`)).status).toBe(404);
    });
  });

  describe("aislamiento entre cuentas", () => {
    it("B no puede crear, listar ni revocar enlaces de A: 404 idéntico al de un grafo inexistente", async () => {
      const share = (await createShare(U.agent, graphId)).body.share.id as string;
      const B = await register(t);

      const create = await createShare(B.agent, graphId);
      const ghostCreate = await createShare(B.agent, randomUUID());
      expect(create.status).toBe(404);
      expect(errorShape(create.body)).toEqual(errorShape(ghostCreate.body));

      const list = await B.agent.get(`/api/v1/graphs/${graphId}/shares`);
      expect(list.status).toBe(404);
      expect(errorShape(list.body)).toEqual(errorShape((await B.agent.get(`/api/v1/graphs/${randomUUID()}/shares`)).body));

      const del = await B.agent.delete(`/api/v1/graphs/${graphId}/shares/${share}`);
      expect(del.status).toBe(404);
      expect(errorShape(del.body)).toEqual(errorShape((await B.agent.delete(`/api/v1/graphs/${graphId}/shares/${randomUUID()}`)).body));

      expect((await t.prisma.shareLink.findUniqueOrThrow({ where: { id: share } })).revokedAt).toBeNull();
      expect(await t.prisma.shareLink.count({ where: { graphId } })).toBe(1);
    });

    it("B no puede revocar un enlace de A usando un grafo propio, y sin sesión todo es 401", async () => {
      const share = (await createShare(U.agent, graphId)).body.share.id as string;
      const B = await register(t);
      const bGraph = await mkGraph(B.agent, "Grafo de B");
      expect((await B.agent.delete(`/api/v1/graphs/${bGraph}/shares/${share}`)).status).toBe(404);
      expect((await t.prisma.shareLink.findUniqueOrThrow({ where: { id: share } })).revokedAt).toBeNull();

      expect((await t.raw().get(`/api/v1/graphs/${graphId}/shares`)).status).toBe(401);
      expect((await t.raw().post(`/api/v1/graphs/${graphId}/shares`).set("Origin", "http://localhost:5173").send({ days: 1 })).status).toBe(401);
      expect((await t.raw().delete(`/api/v1/graphs/${graphId}/shares/${share}`).set("Origin", "http://localhost:5173")).status).toBe(401);
    });
  });

  it("revocar es inmediato e idempotente, y el aviso queda registrado en la auditoría sin el token", async () => {
    const created = await createShare(U.agent, graphId);
    const id = created.body.share.id as string;
    expect((await shared(created.body.token)).status).toBe(200);
    expect((await U.agent.delete(`/api/v1/graphs/${graphId}/shares/${id}`)).status).toBe(204);
    expect((await shared(created.body.token)).status).toBe(404);
    expect((await U.agent.delete(`/api/v1/graphs/${graphId}/shares/${id}`)).status).toBe(204);
    const list = await U.agent.get(`/api/v1/graphs/${graphId}/shares`);
    expect(list.body.items[0].revokedAt).toBeTruthy();

    const audit = await t.prisma.auditLog.findMany({ where: { actorId: U.userId, action: { in: ["share.created", "share.revoked"] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["share.created", "share.revoked"]);
    expect(JSON.stringify(audit)).not.toContain(created.body.token);
  });

  it("un enlace revocado no cuenta para el límite y se puede crear otro", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_SHARES_PER_GRAPH; i++) ids.push((await createShare(U.agent, graphId, 1)).body.share.id);
    await U.agent.delete(`/api/v1/graphs/${graphId}/shares/${ids[0]}`);
    expect((await createShare(U.agent, graphId, 1)).status).toBe(201);
  });
});
