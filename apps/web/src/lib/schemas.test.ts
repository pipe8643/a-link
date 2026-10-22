import { describe, expect, it } from "vitest";
import { applyServerErrors, describeError } from "./form-errors";
import { ApiError } from "./api";
import {
  changePasswordSchema,
  graphSchema,
  loginSchema,
  passwordContainsEmail,
  registerSchema,
  resetPasswordSchema,
} from "./schemas";

const GOOD = "Una-Frase-Larga-2026!";
const errorsOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("passwordContainsEmail (refleja la política del servidor)", () => {
  it("detecta la parte local (≥4 letras) y el correo completo", () => {
    expect(passwordContainsEmail("xxANA.DEMOxx-1234", "ana.demo@example.test")).toBe(true);
    expect(passwordContainsEmail("ana.demo@example.test", "ana.demo@example.test")).toBe(true);
    expect(passwordContainsEmail("Otra-Distinta-2026", "ana.demo@example.test")).toBe(false);
  });
  it("partes locales cortas no se comprueban (evita falsos positivos)", () => {
    expect(passwordContainsEmail("xxabcxx-123456789", "abc@example.test")).toBe(false);
  });
});

describe("registerSchema", () => {
  const base = { displayName: "", email: "ana@example.test", password: GOOD, confirmPassword: GOOD };
  it("acepta datos válidos y normaliza el correo", () => {
    const r = registerSchema.safeParse({ ...base, email: "  ANA@Example.TEST " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("ana@example.test");
  });
  it("exige coincidencia, longitud mínima y máxima", () => {
    expect(errorsOf(registerSchema.safeParse({ ...base, confirmPassword: "otra" }))).toHaveProperty("confirmPassword");
    expect(errorsOf(registerSchema.safeParse({ ...base, password: "corta", confirmPassword: "corta" }))).toHaveProperty("password");
    expect(errorsOf(registerSchema.safeParse({ ...base, password: "x".repeat(129), confirmPassword: "x".repeat(129) }))).toHaveProperty("password");
  });
  it("rechaza contraseñas que contienen el correo", () => {
    const r = registerSchema.safeParse({ ...base, email: "anaaaa@example.test", password: "xxanaaaaxx-2026", confirmPassword: "xxanaaaaxx-2026" });
    expect(r.success).toBe(false);
    expect(errorsOf(r)).toHaveProperty("password");
  });
  it("rechaza correos inválidos", () => {
    expect(errorsOf(registerSchema.safeParse({ ...base, email: "no-es-correo" }))).toHaveProperty("email");
  });
});

describe("otros esquemas", () => {
  it("login: contraseña obligatoria", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
  it("restablecer: confirma coincidencia", () => {
    expect(resetPasswordSchema.safeParse({ newPassword: GOOD, confirmPassword: GOOD + "!" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: GOOD, confirmPassword: GOOD }).success).toBe(true);
  });
  it("cambiar contraseña: la nueva debe ser distinta de la actual", () => {
    const r = changePasswordSchema.safeParse({ currentPassword: GOOD, newPassword: GOOD, confirmPassword: GOOD });
    expect(errorsOf(r)).toHaveProperty("newPassword");
  });
  it("grafo: nombre obligatorio, recortado y sin caracteres de control", () => {
    expect(graphSchema.safeParse({ name: "   ", description: "", folderId: "" }).success).toBe(false);
    expect(graphSchema.safeParse({ name: "mal\u0000", description: "", folderId: "" }).success).toBe(false);
    expect(graphSchema.safeParse({ name: "x".repeat(201), description: "", folderId: "" }).success).toBe(false);
    const ok = graphSchema.safeParse({ name: "  Caso  ", description: "  d  ", folderId: "" });
    expect(ok.success && ok.data).toMatchObject({ name: "Caso", description: "d" });
  });
});

describe("applyServerErrors / describeError", () => {
  it("asocia los errores del servidor a campos conocidos y devuelve null si todos se asociaron", () => {
    const set: Array<[string, string]> = [];
    const err = new ApiError(400, "VALIDATION_ERROR", "Los datos enviados no son válidos.", "r", [{ field: "email", rule: "isEmail" }]);
    const general = applyServerErrors(err, ((f: string, e: { message?: string }) => set.push([f, e.message ?? ""])) as never, ["email"] as never);
    expect(general).toBeNull();
    expect(set).toEqual([["email", "Introduce un correo válido"]]);
  });
  it("si hay errores de campos desconocidos o ninguno, devuelve el mensaje general", () => {
    const err = new ApiError(409, "REGISTER_FAILED", "No se pudo completar el registro.");
    expect(applyServerErrors(err, (() => undefined) as never, [] as never)).toBe("No se pudo completar el registro.");
  });
  it("errores que no son ApiError no filtran detalles", () => {
    expect(describeError(new Error("secreto interno"))).not.toContain("secreto");
  });
  it("añade el tiempo de espera en los 429", () => {
    expect(describeError(new ApiError(429, "X", "Demasiados intentos.", undefined, [], 30))).toContain("30 segundos");
    expect(describeError(new ApiError(429, "X", "Demasiados intentos.", undefined, [], 900))).toContain("15 minutos");
  });
});
