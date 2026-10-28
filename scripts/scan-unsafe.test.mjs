import { describe, expect, it } from "vitest";
import { scanText } from "./scan-unsafe.mjs";

const rules = (text, rel = "apps/api/src/x.ts") => scanText(rel, text).map((f) => f.rule);

describe("scanText: SQL crudo y XSS DOM", () => {
  it("detecta las APIs inseguras de Prisma y los sinks XSS", () => {
    expect(rules("await db.$queryRawUnsafe('SELECT ' + id)")).toContain("Prisma $queryRawUnsafe (inyección SQL)");
    expect(rules("await db.$executeRawUnsafe(sql)")).toContain("Prisma $executeRawUnsafe (inyección SQL)");
    expect(rules("div.dangerouslySetInnerHTML = { __html: x }")).toContain("dangerouslySetInnerHTML (XSS)");
    expect(rules("el.innerHTML = payload")).toContain("asignación a innerHTML (XSS)");
    expect(rules("eval(userCode)")).toContain("eval() (ejecución de código)");
    expect(rules("const f = new Function(body)")).toContain("new Function() (ejecución de código)");
    expect(rules("document.write(html)")).toContain("document.write (XSS)");
  });

  it("no marca $queryRaw etiquetado (parametrizado) ni comentarios", () => {
    expect(rules("await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`")).toEqual([]);
    expect(rules("await this.prisma.client.$queryRaw`SELECT 1`")).toEqual([]);
    expect(rules("// el.innerHTML = 'no'")).toEqual([]);
  });
});
