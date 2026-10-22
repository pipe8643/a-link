import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./route-guards";

describe("safeRedirectPath (evita redirecciones abiertas tras el login)", () => {
  it("acepta rutas internas con query", () => {
    expect(safeRedirectPath("/graphs?folder=root&q=ana")).toBe("/graphs?folder=root&q=ana");
    expect(safeRedirectPath("/settings")).toBe("/settings");
  });

  it.each([
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "http://evil.example",
    "https://evil.example/login",
    "javascript:alert(1)",
    "evil.example",
    "",
    "graphs",
  ])("rechaza %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("cualquier valor que no sea texto vuelve al inicio", () => {
    for (const v of [undefined, null, 42, {}, ["/x"]]) expect(safeRedirectPath(v)).toBe("/");
  });
});
