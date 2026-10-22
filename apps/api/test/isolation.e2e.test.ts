import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

/**
 * El usuario A NO puede ver, modificar ni revocar recursos del usuario B, aunque conozca sus UUID.
 * (Los recursos de dominio —carpetas, grafos, exportaciones— añadirán sus pruebas A/B en las Fases 3-7;
 * aquí se cubre la superficie que ya existe: sesiones y perfil.)
 */
describe.skipIf(!hasDb)("aislamiento entre usuarios (A contra B)", () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof register>>;
  let B: Awaited<ReturnType<typeof register>>;
  let bSessionId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.prisma.auditLog.deleteMany();
    await t.prisma.user.deleteMany();
    A = await register(t);
    B = await register(t);
    bSessionId = (await t.prisma.session.findFirstOrThrow({ where: { userId: B.userId } })).id;
  });

  it("A solo ve SUS sesiones (ninguna de B), sin hashes ni tokens", async () => {
    const res = await A.agent.get("/api/v1/auth/sessions");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const ids: string[] = res.body.items.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(bSessionId);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token/i);
    expect(res.body.items.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it("A NO puede revocar la sesión de B conociendo su UUID, y B sigue autenticado", async () => {
    const res = await A.agent.delete(`/api/v1/auth/sessions/${bSessionId}`);
    expect(res.status).toBe(404);
    expect((await B.agent.get("/api/v1/users/me")).status).toBe(200);
    const row = await t.prisma.session.findUniqueOrThrow({ where: { id: bSessionId } });
    expect(row.revokedAt).toBeNull();
  });

  it("la respuesta ante una sesión ajena es IDÉNTICA a la de una inexistente (no revela existencia)", async () => {
    const foreign = await A.agent.delete(`/api/v1/auth/sessions/${bSessionId}`);
    const missing = await A.agent.delete(`/api/v1/auth/sessions/${randomUUID()}`);
    expect(foreign.status).toBe(missing.status);
    expect({ ...foreign.body, requestId: "" }).toEqual({ ...missing.body, requestId: "" });
  });

  it("valida estrictamente el UUID del parámetro", async () => {
    expect((await A.agent.delete("/api/v1/auth/sessions/no-es-uuid")).status).toBe(400);
    expect((await A.agent.delete("/api/v1/auth/sessions/1")).status).toBe(400);
    expect((await A.agent.delete(`/api/v1/auth/sessions/'%20OR%201=1--`)).status).toBe(400);
  });

  it("A puede revocar sus propias sesiones", async () => {
    const mine = (await t.prisma.session.findFirstOrThrow({ where: { userId: A.userId } })).id;
    expect((await A.agent.delete(`/api/v1/auth/sessions/${mine}`)).status).toBe(204);
    expect((await A.agent.get("/api/v1/users/me")).status).toBe(401);
  });

  it("revocar 'las demás' sesiones de A no toca a B", async () => {
    const second = t.agent();
    await second.post("/api/v1/auth/login").send({ email: A.email, password: A.password });
    expect((await A.agent.post("/api/v1/auth/sessions/revoke-others")).status).toBe(204);
    expect((await second.get("/api/v1/users/me")).status).toBe(401);
    expect((await A.agent.get("/api/v1/users/me")).status).toBe(200);
    expect((await B.agent.get("/api/v1/users/me")).status).toBe(200);
  });

  it("/users/me devuelve SIEMPRE la identidad de la sesión, ignore lo que intente el cliente", async () => {
    const viaQuery = await A.agent.get(`/api/v1/users/me?id=${B.userId}&userId=${B.userId}&ownerId=${B.userId}`);
    expect(viaQuery.body.user.id).toBe(A.userId);
    expect((await A.agent.get(`/api/v1/users/${B.userId}`)).status).toBe(404); // no existe /users/:id
    expect((await A.agent.get(`/api/v1/users/me/${B.userId}`)).status).toBe(404);
  });

  it("A no puede modificar a B enviando su id o email en el cuerpo (asignación masiva rechazada)", async () => {
    const res = await A.agent.patch("/api/v1/users/me").send({ id: B.userId, email: B.email, displayName: "Hackeado" });
    expect(res.status).toBe(400);
    const b = await t.prisma.user.findUniqueOrThrow({ where: { id: B.userId } });
    expect(b.displayName).toBe("Demo");
    expect(b.email).toBe(B.email);
  });

  it("el cambio de contraseña de A no afecta a B", async () => {
    const res = await A.agent
      .post("/api/v1/users/me/password")
      .send({ currentPassword: A.password, newPassword: "Contrasena-Nueva-De-A-9" });
    expect(res.status).toBe(204);
    expect((await B.agent.get("/api/v1/users/me")).status).toBe(200);
    expect((await t.agent().post("/api/v1/auth/login").send({ email: B.email, password: B.password })).status).toBe(200);
  });

  it("el enlace de recuperación de A solo cambia la contraseña de A", async () => {
    await t.agent().post("/api/v1/auth/forgot-password").send({ email: A.email });
    const token = t.mail.lastTokenFor(A.email);
    expect(
      (await t.agent().post("/api/v1/auth/reset-password").send({ token, newPassword: "Restablecida-Solo-A-12" })).status,
    ).toBe(204);
    expect((await t.agent().post("/api/v1/auth/login").send({ email: B.email, password: B.password })).status).toBe(200);
    expect((await B.agent.get("/api/v1/users/me")).status).toBe(200);
  });
});
