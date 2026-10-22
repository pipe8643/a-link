import { describe, expect, it } from "vitest";
import { ConfigError, cookieNameFor, loadConfig } from "../src/config/app-config.js";

const base = {
  APP_ORIGINS: "http://localhost:5173",
  DATABASE_URL: "mysql://u:CONTRASENA-SECRETA@localhost:3306/db",
  SESSION_SECRET: "a".repeat(40),
};

describe("loadConfig", () => {
  it("aplica valores por defecto seguros", () => {
    const c = loadConfig(base);
    expect(c.isProduction).toBe(false);
    expect(c.sessionTtlMs).toBe(12 * 3_600_000);
    expect(c.argon2.memoryCost).toBeGreaterThanOrEqual(19_456); // mínimo recomendado por OWASP
    expect(c.mailDriver).toBe("file");
    expect(c.swaggerEnabled).toBe(true);
  });

  it("normaliza y valida los orígenes", () => {
    expect(loadConfig({ ...base, APP_ORIGINS: " http://a.test:1/ruta , https://b.test " }).appOrigins).toEqual([
      "http://a.test:1",
      "https://b.test",
    ]);
    expect(() => loadConfig({ ...base, APP_ORIGINS: "javascript:alert(1)" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, APP_ORIGINS: "no-es-url" })).toThrow(ConfigError);
  });

  it("falla con secreto corto o URL de BD que no sea mysql, y no revela VALORES en el error", () => {
    let message = "";
    try {
      loadConfig({ ...base, SESSION_SECRET: "corto", DATABASE_URL: "postgresql://u:CONTRASENA-SECRETA@h/db" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("SESSION_SECRET");
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("CONTRASENA-SECRETA");
    expect(message).not.toContain("corto");
  });

  it("trata las variables vacías como no definidas", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
  });

  it("en producción exige https, secreto no de ejemplo y prohíbe el correo en fichero", () => {
    const prod = { ...base, NODE_ENV: "production", APP_ORIGINS: "https://app.example.test" };
    expect(loadConfig(prod).isProduction).toBe(true);
    expect(loadConfig(prod).mailDriver).toBe("disabled");
    expect(loadConfig(prod).swaggerEnabled).toBe(false);
    expect(() => loadConfig({ ...prod, APP_ORIGINS: "http://app.example.test" })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, SESSION_SECRET: "CAMBIAR_POR_UN_VALOR_ALEATORIO_LARGO" })).toThrow(/ejemplo/);
    expect(() => loadConfig({ ...prod, MAIL_DRIVER: "file" })).toThrow(/MAIL_DRIVER/);
  });

  it("la cookie lleva prefijo __Host- solo en producción", () => {
    expect(cookieNameFor(loadConfig(base))).toBe("alink_sid");
    expect(
      cookieNameFor(loadConfig({ ...base, NODE_ENV: "production", APP_ORIGINS: "https://x.test" })),
    ).toBe("__Host-alink_sid");
  });
});
