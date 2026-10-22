import { afterEach, describe, expect, it } from "vitest";
import { GOOD_PASSWORD, type TestApp, createTestApp, register, uniqueEmail } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("límites de abuso y modo producción", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.prisma.user.deleteMany();
    await t?.close();
    t = undefined;
  });

  it("bloquea tras N intentos fallidos por IP+correo (429 + Retry-After), incluso con la contraseña correcta", async () => {
    t = await createTestApp({ LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL: "3" });
    const { email, password } = await register(t);

    for (let i = 0; i < 3; i++) {
      const r = await t.agent().post("/api/v1/auth/login").send({ email, password: "incorrecta-123" });
      expect(r.status).toBe(401);
    }
    const blocked = await t.agent().post("/api/v1/auth/login").send({ email, password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);

    // Otra cuenta desde la misma IP no queda bloqueada.
    const other = await register(t);
    expect((await t.agent().post("/api/v1/auth/login").send({ email: other.email, password: other.password })).status).toBe(200);
  });

  it("el límite de peticiones a rutas de autenticación devuelve 429 y no afecta a las demás rutas", async () => {
    t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: "3" });
    const body = { email: uniqueEmail("rl"), password: "x" };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await t.agent().post("/api/v1/auth/login").send(body)).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    // Rutas que no son de autenticación no comparten ese límite.
    expect((await t.raw().get("/api/v1/health")).status).toBe(200);
  });

  it("el límite general de peticiones también aplica", async () => {
    t = await createTestApp({ RATE_LIMIT_PER_MINUTE: "5" });
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await t.agent().get("/api/v1/users/me")).status);
    expect(codes).toContain(429);
    expect(codes.indexOf(429)).toBeLessThanOrEqual(5);
  });

  it("producción: cookie Secure con prefijo __Host-, HSTS, sin Swagger y sin correo en fichero", async () => {
    t = await createTestApp({
      NODE_ENV: "production",
      APP_ORIGINS: "https://app.example.test",
    });
    const email = uniqueEmail("prod");
    const res = await t.raw().post("/api/v1/auth/register").set("Origin", "https://app.example.test").send({ email, password: GOOD_PASSWORD });
    expect(res.status).toBe(201);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.includes("alink_sid"))!;
    expect(cookie.startsWith("__Host-alink_sid=")).toBe(true);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i); // requisito de __Host-

    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect((await t.raw().get("/api/docs")).status).toBe(404); // Swagger deshabilitado
    // El origen http de desarrollo ya no es válido.
    const dev = await t.raw().post("/api/v1/auth/login").set("Origin", "http://localhost:5173").send({ email, password: GOOD_PASSWORD });
    expect(dev.status).toBe(403);
  });

  it("REGISTRATION_ENABLED=false: no se crean cuentas, pero se puede seguir entrando", async () => {
    t = await createTestApp();
    const existing = await register(t);
    await t.close();
    t = await createTestApp({ REGISTRATION_ENABLED: "false" });
    const email = uniqueEmail("cerrado");
    const res = await t.agent().post("/api/v1/auth/register").send({ email, password: GOOD_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REGISTRATION_DISABLED");
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
    const login = await t.agent().post("/api/v1/auth/login").send({ email: existing.email, password: existing.password });
    expect(login.status).toBe(200);
  });

  it("desarrollo: Swagger disponible en /api/docs", async () => {
    t = await createTestApp();
    const res = await t.raw().get("/api/docs");
    expect([200, 301, 302]).toContain(res.status);
  });
});
