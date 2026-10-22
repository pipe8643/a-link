import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./zod-config";

describe("zod sin compilación dinámica (compatible con una CSP sin 'unsafe-eval')", () => {
  it("jitless está activo y los esquemas siguen validando igual", () => {
    expect(z.config().jitless).toBe(true);
    const schema = z.object({ a: z.string().min(2), b: z.array(z.number()).default([]) }).strict();
    expect(schema.parse({ a: "ok" })).toEqual({ a: "ok", b: [] });
    expect(schema.safeParse({ a: "x" }).success).toBe(false);
    expect(schema.safeParse({ a: "ok", extra: 1 }).success).toBe(false);
  });

  it("nunca se llama a Function ni a eval al validar", () => {
    const original = globalThis.Function;
    let calls = 0;
    globalThis.Function = new Proxy(original, { construct: (...args) => (calls++, Reflect.construct(...args)) }) as FunctionConstructor;
    try {
      z.object({ n: z.number().int() }).parse({ n: 1 });
    } finally {
      globalThis.Function = original;
    }
    expect(calls).toBe(0);
  });
});
