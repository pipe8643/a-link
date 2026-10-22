import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GOOD_PASSWORD,
  TEST_ORIGIN,
  type TestApp,
  cookieOf,
  cookieValue,
  createTestApp,
  register,
  uniqueEmail,
} from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("autenticación (API real + MySQL)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    t.mail.sent = [];
    await t.prisma.auditLog.deleteMany();
    await t.prisma.user.deleteMany();
  });

  // ------------------------------------------------------------------ registro y sesión
  describe("registro y sesión", () => {
    it("registra, devuelve el usuario SIN datos sensibles y abre sesión con cookie segura", async () => {
      const email = uniqueEmail();
      const res = await t.agent().post("/api/v1/auth/register").send({ email, password: GOOD_PASSWORD, displayName: "Ana" });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email, displayName: "Ana" });
      expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2|password/i);

      const cookie = cookieOf(res)!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Secure/i); // solo en producción (ver prueba de producción)
    });

    it("guarda la contraseña con Argon2id y el token de sesión solo como HMAC (nunca en claro)", async () => {
      const { res, email } = await register(t);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(GOOD_PASSWORD);

      const token = cookieValue(cookieOf(res))!;
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(session.tokenHash).not.toBe(token);
      expect(token.length).toBeGreaterThanOrEqual(40);
    });

    it("la sesión sobrevive a una recarga (nueva petición con la misma cookie)", async () => {
      const { agent } = await register(t);
      const a = await agent.get("/api/v1/users/me");
      const b = await agent.get("/api/v1/users/me");
      expect(a.status).toBe(200);
      expect(b.body.user.id).toBe(a.body.user.id);
    });

    it("el correo se normaliza (mayúsculas y espacios) y no se pueden duplicar cuentas", async () => {
      const email = uniqueEmail("dup");
      const first = await t.agent().post("/api/v1/auth/register").send({ email: `  ${email.toUpperCase()}  `, password: GOOD_PASSWORD });
      expect(first.status).toBe(201);
      expect(first.body.user.email).toBe(email);

      const again = await t.agent().post("/api/v1/auth/register").send({ email, password: GOOD_PASSWORD });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("REGISTER_FAILED");
    });

    it("rechaza contraseñas cortas, gigantes o que contengan el correo", async () => {
      const email = uniqueEmail("clavefacil");
      const local = email.split("@")[0]!;
      for (const password of ["corta", "x".repeat(129), `${local}-12345678`]) {
        const res = await t.agent().post("/api/v1/auth/register").send({ email, password });
        expect(res.status).toBe(400);
      }
      expect(await t.prisma.user.count({ where: { email } })).toBe(0);
    });

    it("asignación masiva: campos no declarados (ownerId, id, isAdmin...) se RECHAZAN", async () => {
      const res = await t.agent().post("/api/v1/auth/register").send({
        email: uniqueEmail(),
        password: GOOD_PASSWORD,
        id: "00000000-0000-4000-8000-000000000000",
        isAdmin: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(["id", "isAdmin"]);
    });
  });

  // ------------------------------------------------------------------ login / logout
  describe("inicio y cierre de sesión", () => {
    it("login correcto crea una sesión nueva", async () => {
      const { email, password } = await register(t);
      const agent = t.agent();
      const res = await agent.post("/api/v1/auth/login").send({ email: email.toUpperCase(), password });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
      expect((await agent.get("/api/v1/users/me")).status).toBe(200);
    });

    it("credenciales erróneas: MISMO mensaje y código exista o no la cuenta (no filtra información)", async () => {
      const { email } = await register(t);
      const wrongPass = await t.agent().post("/api/v1/auth/login").send({ email, password: "otra-contrasena-1" });
      const noUser = await t.agent().post("/api/v1/auth/login").send({ email: uniqueEmail("nadie"), password: "otra-contrasena-1" });
      expect(wrongPass.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(wrongPass.body.code).toBe("INVALID_CREDENTIALS");
      expect(noUser.body.code).toBe(wrongPass.body.code);
      expect(noUser.body.message).toBe(wrongPass.body.message);
      expect(cookieOf(wrongPass)).toBeUndefined();
    });

    it("logout revoca la sesión en el servidor: la cookie robada ya no sirve", async () => {
      const { agent, res } = await register(t);
      const stolen = cookieOf(res)!.split(";")[0]!;
      expect((await agent.post("/api/v1/auth/logout")).status).toBe(204);
      expect((await agent.get("/api/v1/users/me")).status).toBe(401);
      // Reutilizar la cookie anterior desde otro cliente (reproducción) también falla.
      const replay = await t.raw().get("/api/v1/users/me").set("Cookie", stolen);
      expect(replay.status).toBe(401);
    });

    it("logout es idempotente y sin sesión no falla", async () => {
      expect((await t.agent().post("/api/v1/auth/logout")).status).toBe(204);
    });

    it("sesiones caducadas o con token inventado se rechazan", async () => {
      const { agent, userId } = await register(t);
      await t.prisma.session.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await agent.get("/api/v1/users/me")).status).toBe(401);
      const fake = await t.raw().get("/api/v1/users/me").set("Cookie", "alink_sid=token-inventado");
      expect(fake.status).toBe(401);
    });
  });

  // ------------------------------------------------------------------ rutas protegidas
  describe("protección de rutas (denegar por defecto)", () => {
    it.each([
      ["GET", "/api/v1/users/me"],
      ["PATCH", "/api/v1/users/me"],
      ["POST", "/api/v1/users/me/password"],
      ["GET", "/api/v1/auth/sessions"],
      ["POST", "/api/v1/auth/sessions/revoke-others"],
    ])("%s %s exige autenticación", async (method, path) => {
      const res = await t.agent()[method.toLowerCase() as "get"](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    });

    it("/health es público y no expone detalles", async () => {
      const res = await t.raw().get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  // ------------------------------------------------------------------ perfil y contraseña
  describe("perfil y cambio de contraseña", () => {
    it("actualiza el perfil y rechaza campos no permitidos (email, id)", async () => {
      const { agent } = await register(t);
      const ok = await agent.patch("/api/v1/users/me").send({ displayName: "  Nuevo Nombre " });
      expect(ok.status).toBe(200);
      expect(ok.body.user.displayName).toBe("Nuevo Nombre");
      const bad = await agent.patch("/api/v1/users/me").send({ email: uniqueEmail(), id: "x" });
      expect(bad.status).toBe(400);
    });

    it("cambia la contraseña, mantiene la sesión actual y CIERRA las demás", async () => {
      const { agent, email, password } = await register(t);
      const other = t.agent();
      await other.post("/api/v1/auth/login").send({ email, password });
      expect((await other.get("/api/v1/users/me")).status).toBe(200);

      const newPassword = "Otra-Contrasena-Nueva-77";
      const res = await agent.post("/api/v1/users/me/password").send({ currentPassword: password, newPassword });
      expect(res.status).toBe(204);

      expect((await agent.get("/api/v1/users/me")).status).toBe(200); // la actual sigue
      expect((await other.get("/api/v1/users/me")).status).toBe(401); // la otra se cerró
      expect((await t.agent().post("/api/v1/auth/login").send({ email, password })).status).toBe(401);
      expect((await t.agent().post("/api/v1/auth/login").send({ email, password: newPassword })).status).toBe(200);
    });

    it("exige la contraseña actual correcta", async () => {
      const { agent } = await register(t);
      const res = await agent.post("/api/v1/users/me/password").send({ currentPassword: "incorrecta-123", newPassword: "Otra-Contrasena-Nueva-77" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURRENT_PASSWORD");
    });
  });

  // ------------------------------------------------------------------ recuperación
  describe("recuperación de contraseña", () => {
    it("responde IGUAL exista o no la cuenta y solo envía correo si existe", async () => {
      const { email } = await register(t);
      const known = await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const unknown = await t.agent().post("/api/v1/auth/forgot-password").send({ email: uniqueEmail("nadie") });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual(known.body);
      expect(t.mail.sent).toHaveLength(1);
      expect(t.mail.sent[0]!.to).toBe(email);
    });

    it("el enlace del correo apunta a la ruta REAL del frontend (/reset-password) en un origen permitido", async () => {
      // Regresión: el enlace llegó a apuntar a una ruta que la SPA no tenía (lo detectó el E2E de Playwright).
      const { email } = await register(t);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const url = new URL(t.mail.sent.at(-1)!.resetUrl);
      expect(url.pathname).toBe("/reset-password");
      expect(url.origin).toBe(t.config.appOrigins[0]);
      expect(url.search).toBe("");
      expect(url.hash.slice(1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("el token es de un solo uso, restablece la contraseña y cierra todas las sesiones", async () => {
      const { agent, email, password } = await register(t);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const token = t.mail.lastTokenFor(email);

      // En BD solo existe el HMAC del token.
      const row = await t.prisma.passwordResetToken.findFirstOrThrow({ where: { user: { email } } });
      expect(row.tokenHash).not.toBe(token);

      const newPassword = "Restablecida-Segura-55";
      const ok = await t.agent().post("/api/v1/auth/reset-password").send({ token, newPassword });
      expect(ok.status).toBe(204);

      expect((await agent.get("/api/v1/users/me")).status).toBe(401); // sesiones previas cerradas
      expect((await t.agent().post("/api/v1/auth/login").send({ email, password })).status).toBe(401);
      expect((await t.agent().post("/api/v1/auth/login").send({ email, password: newPassword })).status).toBe(200);

      const reuse = await t.agent().post("/api/v1/auth/reset-password").send({ token, newPassword: "Intento-De-Reutilizar-1" });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe("INVALID_RESET_TOKEN");
    });

    it("un token caducado o inventado se rechaza con el mismo error", async () => {
      const { email } = await register(t);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const token = t.mail.lastTokenFor(email);
      await t.prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const expired = await t.agent().post("/api/v1/auth/reset-password").send({ token, newPassword: "Nueva-Contrasena-123" });
      const fake = await t.agent().post("/api/v1/auth/reset-password").send({ token: "x".repeat(43), newPassword: "Nueva-Contrasena-123" });
      expect(expired.status).toBe(400);
      expect(fake.status).toBe(400);
      expect(fake.body.code).toBe(expired.body.code);
    });

    it("solo el enlace MÁS RECIENTE es válido", async () => {
      const { email } = await register(t);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const first = t.mail.lastTokenFor(email);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const second = t.mail.lastTokenFor(email);
      expect(second).not.toBe(first);
      expect((await t.agent().post("/api/v1/auth/reset-password").send({ token: first, newPassword: "Nueva-Contrasena-123" })).status).toBe(400);
      expect((await t.agent().post("/api/v1/auth/reset-password").send({ token: second, newPassword: "Nueva-Contrasena-123" })).status).toBe(204);
    });

    it("dos usos simultáneos del mismo token: solo UNO tiene éxito", async () => {
      const { email } = await register(t);
      await t.agent().post("/api/v1/auth/forgot-password").send({ email });
      const token = t.mail.lastTokenFor(email);
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => t.agent().post("/api/v1/auth/reset-password").send({ token, newPassword: `Concurrente-Segura-${i}${i}${i}` })),
      );
      expect(results.filter((r) => r.status === 204)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(3);
    });
  });

  // ------------------------------------------------------------------ protecciones transversales
  describe("protecciones transversales", () => {
    it("CSRF: rechaza peticiones que modifican estado sin Origin o con Origin ajeno", async () => {
      const body = { email: uniqueEmail(), password: GOOD_PASSWORD };
      const none = await t.raw().post("/api/v1/auth/register").send(body);
      const evil = await t.raw().post("/api/v1/auth/register").set("Origin", "https://sitio-malicioso.example").send(body);
      expect(none.status).toBe(403);
      expect(evil.status).toBe(403);
      expect(evil.body.code).toBe("CSRF_ORIGIN");
      expect(await t.prisma.user.count({ where: { email: body.email } })).toBe(0);

      const ok = await t.raw().post("/api/v1/auth/register").set("Origin", TEST_ORIGIN).send(body);
      expect(ok.status).toBe(201);
    });

    it("CSRF: el Referer permitido sirve cuando no hay Origin; un Referer ajeno no", async () => {
      const mk = () => ({ email: uniqueEmail(), password: GOOD_PASSWORD });
      const good = await t.raw().post("/api/v1/auth/register").set("Referer", `${TEST_ORIGIN}/registro`).send(mk());
      const bad = await t.raw().post("/api/v1/auth/register").set("Referer", "https://otro.example/x").send(mk());
      expect(good.status).toBe(201);
      expect(bad.status).toBe(403);
    });

    it("CORS: solo responde a orígenes configurados y permite credenciales", async () => {
      const good = await t.raw().options("/api/v1/users/me").set("Origin", TEST_ORIGIN).set("Access-Control-Request-Method", "GET");
      expect(good.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
      expect(good.headers["access-control-allow-credentials"]).toBe("true");
      const bad = await t.raw().options("/api/v1/users/me").set("Origin", "https://otro.example").set("Access-Control-Request-Method", "GET");
      expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("cabeceras de seguridad y sin cache en la API; sin X-Powered-By", async () => {
      const res = await t.raw().get("/api/v1/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBeTruthy();
      expect(res.headers["content-security-policy"]).toBeTruthy();
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("errores con formato uniforme, sin trazas ni datos internos, y con requestId", async () => {
      const res = await t.agent().post("/api/v1/auth/login").send({ email: "no-es-correo", password: "x" });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
      expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|at .*\(|prisma|mysql/i);
      expect(JSON.stringify(res.body)).not.toContain("no-es-correo"); // no devuelve el valor enviado

      const notFound = await t.agent().get("/api/v1/no-existe");
      expect(notFound.status).toBe(404);
      expect(notFound.body.code).toBe("HTTP_404");
    });

    it("JSON mal formado y cuerpos demasiado grandes devuelven 400/413 controlados", async () => {
      const bad = await t.agent().post("/api/v1/auth/login").set("Content-Type", "application/json").send("{no es json");
      expect(bad.status).toBe(400);
      const big = await t.agent().post("/api/v1/auth/login").send({ email: "a@x.test", password: "x".repeat(3 * 1024 * 1024) });
      expect(big.status).toBe(413);
      expect(big.body.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("la auditoría registra acciones SIN datos sensibles", async () => {
      const { email, password } = await register(t);
      await t.agent().post("/api/v1/auth/login").send({ email, password: "incorrecta-123" });
      const logs = await t.prisma.auditLog.findMany({ orderBy: { timestamp: "asc" } });
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["auth.register", "auth.login_failed"]));
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(password);
      expect(dump).not.toContain(email);
      expect(dump).not.toMatch(/argon2|token/i);
    });
  });
});
