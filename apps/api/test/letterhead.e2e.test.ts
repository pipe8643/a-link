import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LETTERHEAD_LIMITS } from "@a-link/shared";
import { errorShape, mkGraph, resetDatabase } from "./helpers/domain.js";
import { MIME, makeCleanJpeg, makeCleanPng, makePng } from "./helpers/files.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;
type Agent = Awaited<ReturnType<typeof register>>["agent"];

const put = (agent: Agent, body: Buffer, mime: string) => agent.put("/api/v1/users/me/letterhead").set("Content-Type", mime).send(body);
const getBin = (agent: Agent) =>
  agent.get("/api/v1/users/me/letterhead").buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });

describe.skipIf(!hasDb)("membrete personal: subida, lectura, aislamiento y visor compartido (API real + MySQL)", () => {
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

  it("guarda un JPEG limpio, lo lee idéntico y sustituye al volver a subir", async () => {
    const first = makeCleanJpeg(64, 36, { seed: "aaaa" });
    const created = await put(U.agent, first, MIME.jpeg);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.letterhead).toMatchObject({ mime: MIME.jpeg, width: 64, height: 36, size: first.length });
    expect(Object.keys(created.body.letterhead).sort()).toEqual(["height", "mime", "size", "updatedAt", "width"]);

    const got = await getBin(U.agent);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body as Buffer, first)).toBe(0);
    expect(got.headers["content-type"]).toBe(MIME.jpeg);
    expect(got.headers["x-content-type-options"]).toBe("nosniff");

    const second = makeCleanPng(48, 48, "bbbb");
    const replaced = await put(U.agent, second, MIME.png);
    expect(replaced.status).toBe(200);
    expect(replaced.body.letterhead).toMatchObject({ mime: MIME.png, width: 48, height: 48 });
    expect(await t.prisma.userLetterhead.count({ where: { userId: U.userId } })).toBe(1);
    const again = await getBin(U.agent);
    expect(Buffer.compare(again.body as Buffer, second)).toBe(0);
  });

  it("rechaza EXIF, tipo declarado mentiroso y un lado mayor que el tope del membrete", async () => {
    expect((await put(U.agent, makeCleanJpeg(8, 8, { exif: true }), MIME.jpeg)).status).toBe(415);
    expect((await put(U.agent, makeCleanPng(16, 16), MIME.jpeg)).status).toBe(415);
    expect((await put(U.agent, makePng(), MIME.png)).status).toBe(415);
    const tooWide = makeCleanPng(LETTERHEAD_LIMITS.maxSide + 1, 8);
    expect((await put(U.agent, tooWide, MIME.png)).status).toBe(415);
  });

  it("ajeno, anónimo o sin membrete: el mismo 404 (o 401 si no hay sesión)", async () => {
    expect((await U.agent.get("/api/v1/users/me/letterhead")).status).toBe(404);
    expect((await U.agent.delete("/api/v1/users/me/letterhead")).status).toBe(404);
    await put(U.agent, makeCleanPng(12, 12, "cc"), MIME.png);
    const B = await register(t);
    expect((await B.agent.get("/api/v1/users/me/letterhead")).status).toBe(404);
    expect((await t.raw().get("/api/v1/users/me/letterhead")).status).toBe(401);
    expect((await t.raw().put("/api/v1/users/me/letterhead").set("Content-Type", MIME.png).send(makeCleanPng())).status).toBe(401);
  });

  it("borrar deja el visor sin imagen; el visor público solo ve el membrete del propietario con un token válido", async () => {
    const body = makeCleanPng(20, 10, "dd");
    expect((await put(U.agent, body, MIME.png)).status).toBe(200);
    const graphId = await mkGraph(U.agent, "Con membrete");
    const created = await U.agent.post(`/api/v1/graphs/${graphId}/shares`).send({ days: 7 });
    const token = created.body.token as string;

    const shared = await t.raw().get("/api/v1/shared/letterhead").set("X-Share-Token", token).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(shared.status).toBe(200);
    expect(Buffer.compare(shared.body as Buffer, body)).toBe(0);

    expect((await t.raw().get("/api/v1/shared/letterhead")).status).toBe(404);
    expect((await t.raw().get("/api/v1/shared/letterhead").set("X-Share-Token", "no-es-un-token-valido-de-43-caracteres!!")).status).toBe(404);

    expect((await U.agent.delete("/api/v1/users/me/letterhead")).status).toBe(204);
    expect((await U.agent.get("/api/v1/users/me/letterhead")).status).toBe(404);
    expect((await t.raw().get("/api/v1/shared/letterhead").set("X-Share-Token", token)).status).toBe(404);
    expect(errorShape((await U.agent.get("/api/v1/users/me/letterhead")).body)).toMatchObject({ code: "NOT_FOUND" });
  });
});
