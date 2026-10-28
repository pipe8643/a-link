import { describe, expect, it } from "vitest";
import { isSafeHttpUrl } from "../src/safe-input.js";

describe("isSafeHttpUrl", () => {
  it("admite http/https y el vacío (campo opcional)", () => {
    expect(isSafeHttpUrl("")).toBe(true);
    expect(isSafeHttpUrl("https://example.test/u/ana")).toBe(true);
    expect(isSafeHttpUrl("http://example.test")).toBe(true);
  });

  it("bloquea esquemas que ejecutarían código o cargarían datos locales (XSS)", () => {
    for (const v of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "about:blank",
    ]) {
      expect(isSafeHttpUrl(v), v).toBe(false);
    }
  });

  it("bloquea credenciales, espacios y caracteres de control", () => {
    expect(isSafeHttpUrl("https://user:pass@example.test")).toBe(false);
    expect(isSafeHttpUrl(" https://example.test")).toBe(false);
    expect(isSafeHttpUrl("https://example.test/path with space")).toBe(false);
    expect(isSafeHttpUrl("https://example.test/mal\u0000")).toBe(false);
    expect(isSafeHttpUrl("no es una url")).toBe(false);
  });
});
