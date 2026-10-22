import { describe, expect, it } from "vitest";
import { parseDatabaseUrl } from "../src/db/prisma-client.js";

describe("parseDatabaseUrl", () => {
  it("decodifica usuario y contraseña con caracteres especiales", () => {
    const c = parseDatabaseUrl("mysql://alink:p%40ss%21w%2Frd@localhost:3306/a_link");
    expect(c.user).toBe("alink");
    expect(c.password).toBe("p@ss!w/rd");
    expect(c.database).toBe("a_link");
    expect(c.port).toBe(3306);
  });

  it("usa el puerto 3306 por defecto", () => {
    expect(parseDatabaseUrl("mysql://u:p@localhost/db").port).toBe(3306);
  });

  it("en bucle local permite la recuperación de clave pública (desarrollo)", () => {
    expect(parseDatabaseUrl("mysql://u:p@localhost/db").allowPublicKeyRetrieval).toBe(true);
    expect(parseDatabaseUrl("mysql://u:p@127.0.0.1:3307/db").allowPublicKeyRetrieval).toBe(true);
  });

  it("en un host remoto NO permite la recuperación de clave pública sin TLS", () => {
    const c = parseDatabaseUrl("mysql://u:p@db.interno.example/db");
    expect(c.allowPublicKeyRetrieval).toBe(false);
    expect("ssl" in c).toBe(false);
  });

  it("?ssl=true activa TLS con validación de certificado", () => {
    const c = parseDatabaseUrl("mysql://u:p@db.example/db?ssl=true");
    expect(c.ssl).toBe(true);
    expect(c.allowPublicKeyRetrieval).toBe(false);
  });

  it("?ssl=insecure cifra pero no valida el certificado", () => {
    const c = parseDatabaseUrl("mysql://u:p@db.example/db?ssl=insecure");
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("rechaza esquemas que no sean mysql://", () => {
    expect(() => parseDatabaseUrl("postgresql://u:p@localhost/db")).toThrow(/mysql/);
  });

  it("define un tiempo máximo de conexión (evita cuelgues silenciosos)", () => {
    expect(parseDatabaseUrl("mysql://u:p@localhost/db").connectTimeout).toBeGreaterThan(0);
  });
});
