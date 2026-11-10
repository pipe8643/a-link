import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema } from "@a-link/shared";
import { describe, expect, it } from "vitest";
import { jsonForScript, toStandalonePayload } from "./standalone-payload";

describe("toStandalonePayload", () => {
  it("omite notas y campos sensibles, y no incluye descripción de la relación", () => {
    const ana = nodeInputSchema.parse({
      id: randomUUID(),
      type: "person",
      label: "Ana",
      notes: "SECRETO",
      metadata: { fullName: "Ana Pérez", internalId: "DNI-1" },
      positionX: 10,
      positionY: 20,
    });
    const casa = nodeInputSchema.parse({ id: randomUUID(), type: "property", label: "Casa", positionX: 100, positionY: 0 });
    const e = edgeInputSchema.parse({
      id: randomUUID(),
      sourceId: ana.id,
      targetId: casa.id,
      relationshipType: "ownership",
      metadata: { evidenceClass: "recorded", source: "interno", description: "no difundir", confidence: 90 },
    });
    const payload = toStandalonePayload(
      { nodes: [ana, casa], edges: [e] },
      new Map([
        [ana.id, { x: 10, y: 20 }],
        [casa.id, { x: 100, y: 0 }],
      ]),
      new Map(),
      { title: "Caso", generatedAt: new Date("2026-03-04T12:00:00Z"), edgeLabels: true },
    );
    expect(JSON.stringify(payload)).not.toContain("SECRETO");
    expect(JSON.stringify(payload)).not.toContain("DNI-1");
    expect(JSON.stringify(payload)).not.toContain("no difundir");
    expect(JSON.stringify(payload)).not.toContain("interno");
    expect(payload.nodes[0]).toMatchObject({ label: "Ana", x: 10, y: 20, fields: [{ label: "Nombre", value: "Ana Pérez" }] });
    expect(payload.edges[0]?.label).toBe("Propiedad");
    expect(payload.edges[0]?.evidence).toBe("recorded");
  });
});

describe("jsonForScript", () => {
  it("escapa </script> para no romper el HTML", () => {
    expect(jsonForScript({ label: "</script><img>" })).toContain("\\u003c/script>");
    expect(jsonForScript({ label: "</script><img>" })).not.toContain("</script>");
  });
});
