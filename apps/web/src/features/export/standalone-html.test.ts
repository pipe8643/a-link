import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema } from "@a-link/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStandaloneHtml } from "./standalone-html";
import { toStandalonePayload } from "./standalone-payload";

function payload() {
  const ana = nodeInputSchema.parse({
    id: randomUUID(),
    type: "person",
    label: "Ana",
    notes: "SECRETO",
    metadata: { fullName: "Ana Pérez" },
    positionX: 0,
    positionY: 0,
  });
  const casa = nodeInputSchema.parse({ id: randomUUID(), type: "property", label: "Casa", positionX: 180, positionY: 40 });
  const e = edgeInputSchema.parse({
    id: randomUUID(),
    sourceId: ana.id,
    targetId: casa.id,
    relationshipType: "ownership",
    metadata: { evidenceClass: "recorded" },
  });
  return toStandalonePayload(
    { nodes: [ana, casa], edges: [e] },
    new Map([
      [ana.id, { x: 0, y: 0 }],
      [casa.id, { x: 180, y: 40 }],
    ]),
    new Map(),
    { title: "Caso portable", generatedAt: new Date("2026-03-04T12:00:00Z"), edgeLabels: true },
  );
}

describe("buildStandaloneHtml", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("es un solo fichero: CSP sin red, datos incrustados y el visor arranca en el DOM", () => {
    const html = buildStandaloneHtml(payload());
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("img-src data:");
    expect(html).not.toContain("zoomcharts");
    expect(html).not.toContain("/s#");
    expect(html).not.toContain("SECRETO");
    expect(html).not.toMatch(/\bfetch\s*\(/);

    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1];
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
    expect(body).toBeTruthy();
    expect(script).toBeTruthy();

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    document.body.innerHTML = body!.replace(/<script>[\s\S]*<\/script>/, "");
    // eslint-disable-next-line no-eval -- el runtime va incrustado en el HTML portable
    eval(script!);

    expect(document.getElementById("title")?.textContent).toBe("Caso portable");
    expect(document.querySelectorAll("circle").length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).toContain("Ana");
    expect(document.body.textContent).toContain("Casa");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
