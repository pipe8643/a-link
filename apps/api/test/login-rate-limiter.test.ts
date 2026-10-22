import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/app-config.js";
import { LoginRateLimiter } from "../src/auth/login-rate-limiter.js";

function make(perIpEmail = 3, perEmail = 5) {
  const config = loadConfig({
    APP_ORIGINS: "http://localhost:5173",
    DATABASE_URL: "mysql://u:p@localhost/db",
    SESSION_SECRET: "a".repeat(40),
    LOGIN_MAX_ATTEMPTS_PER_IP_EMAIL: String(perIpEmail),
    LOGIN_MAX_ATTEMPTS_PER_EMAIL: String(perEmail),
  });
  const limiter = new LoginRateLimiter(config);
  let t = 1_000_000;
  limiter.clock = () => t;
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe("LoginRateLimiter", () => {
  it("permite intentos hasta el umbral y luego bloquea con tiempo de espera", () => {
    const { limiter } = make(3);
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterSeconds("1.1.1.1", "a@x.test")).toBe(0);
      limiter.recordFailure("1.1.1.1", "a@x.test");
    }
    expect(limiter.retryAfterSeconds("1.1.1.1", "a@x.test")).toBeGreaterThan(0);
  });

  it("un tercero desde otra IP NO bloquea a la víctima (clave IP+correo)", () => {
    const { limiter } = make(3, 100);
    for (let i = 0; i < 10; i++) limiter.recordFailure("6.6.6.6", "victima@x.test");
    expect(limiter.retryAfterSeconds("6.6.6.6", "victima@x.test")).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("2.2.2.2", "victima@x.test")).toBe(0);
  });

  it("frena un ataque distribuido contra una misma cuenta (clave solo correo)", () => {
    const { limiter } = make(100, 5);
    for (let i = 0; i < 5; i++) limiter.recordFailure(`10.0.0.${i}`, "objetivo@x.test");
    expect(limiter.retryAfterSeconds("10.9.9.9", "objetivo@x.test")).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds("10.9.9.9", "otro@x.test")).toBe(0);
  });

  it("el bloqueo expira con el tiempo", () => {
    const { limiter, advance } = make(2);
    limiter.recordFailure("1.1.1.1", "a@x.test");
    limiter.recordFailure("1.1.1.1", "a@x.test");
    expect(limiter.retryAfterSeconds("1.1.1.1", "a@x.test")).toBeGreaterThan(0);
    advance(15 * 60_000 + 1000);
    expect(limiter.retryAfterSeconds("1.1.1.1", "a@x.test")).toBe(0);
  });

  it("un inicio de sesión correcto reinicia el contador de esa IP+correo", () => {
    const { limiter } = make(3);
    limiter.recordFailure("1.1.1.1", "a@x.test");
    limiter.recordFailure("1.1.1.1", "a@x.test");
    limiter.recordSuccess("1.1.1.1", "a@x.test");
    limiter.recordFailure("1.1.1.1", "a@x.test");
    expect(limiter.retryAfterSeconds("1.1.1.1", "a@x.test")).toBe(0);
  });
});
