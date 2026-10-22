import { describe, expect, it } from "vitest";
import {
  buildNode,
  defaultLabel,
  emptyRelationshipForm,
  entityToForm,
  issuesToErrors,
  newId,
  parseEntityForm,
  parseRelationshipForm,
  relationshipToForm,
  splitTags,
} from "./editor-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function node(type: "person" | "vehicle" | "phone" = "person") {
  const r = buildNode(type, []);
  if (!r.ok) throw new Error("no se pudo crear");
  return r.value;
}

describe("newId", () => {
  it("genera UUID v4 distintos", () => {
    const a = newId();
    expect(a).toMatch(UUID);
    expect(newId()).not.toBe(a);
  });
});

describe("buildNode / defaultLabel", () => {
  it("crea una entidad válida con nombre legible", () => {
    const n = node();
    expect(n.label).toBe("Persona");
    expect(n.metadata).toEqual({});
    expect(n.positionX).toBeNull();
  });

  it("evita nombres repetidos", () => {
    const a = node();
    const b = { ...node(), label: "Persona 2" };
    expect(defaultLabel("person", [a])).toBe("Persona 2");
    expect(defaultLabel("person", [a, b])).toBe("Persona 3");
    expect(defaultLabel("person", [{ ...a, label: "PERSONA" }])).toBe("Persona 2");
  });
});

describe("parseEntityForm", () => {
  it("acepta valores válidos y descarta metadatos vacíos", () => {
    const base = node("vehicle");
    const form = entityToForm(base);
    const r = parseEntityForm(base, { ...form, label: "  Camioneta  ", tags: "a, b ,, c", metadata: { ...form.metadata, make: "Ford", plate: "" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBe("Camioneta");
      expect(r.value.tags).toEqual(["a", "b", "c"]);
      expect(r.value.metadata).toEqual({ make: "Ford" });
      expect(r.value.id).toBe(base.id);
      expect(r.value.type).toBe("vehicle");
    }
  });

  it("informa el error en el campo concreto", () => {
    const base = node("vehicle");
    const form = entityToForm(base);
    const r = parseEntityForm(base, { ...form, label: "   ", metadata: { ...form.metadata, plate: "@@", vin: "123" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.label).toMatch(/obligatorio/i);
      expect(r.errors["metadata.plate"]).toMatch(/matrícula/i);
      expect(r.errors["metadata.vin"]).toMatch(/VIN/);
    }
  });

  it("rechaza etiquetas repetidas y no muestra el valor escrito", () => {
    const base = node();
    const form = entityToForm(base);
    const r = parseEntityForm(base, { ...form, tags: "uno, UNO" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.tags).toMatch(/repetidas/i);
      expect(JSON.stringify(r.errors)).not.toContain("uno");
    }
  });

  it("rechaza URL peligrosas en redes sociales", () => {
    const r0 = buildNode("other", []);
    if (!r0.ok) throw new Error();
    const social = { ...r0.value, type: "social" as const };
    const form = entityToForm(social);
    const r = parseEntityForm(social, { ...form, metadata: { ...form.metadata, profileUrl: "javascript:alert(1)" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["metadata.profileUrl"]).toBeTruthy();
  });

  it("conserva la posición del nodo", () => {
    const base = { ...node(), positionX: 10, positionY: -5 };
    const r = parseEntityForm(base, entityToForm(base));
    expect(r.ok && [r.value.positionX, r.value.positionY]).toEqual([10, -5]);
  });
});

describe("parseRelationshipForm", () => {
  const a = node();
  const b = node("phone");

  it("por defecto es hipótesis y dirección hacia delante", () => {
    const r = parseRelationshipForm(newId(), emptyRelationshipForm(a.id, b.id), [], true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.metadata.evidenceClass).toBe("hypothesis");
      expect(r.value.metadata.direction).toBe("forward");
    }
  });

  it("rechaza auto-relaciones en el campo destino", () => {
    const r = parseRelationshipForm(newId(), emptyRelationshipForm(a.id, a.id), [], true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.targetId).toMatch(/distintas/i);
  });

  it("valida fechas y su orden", () => {
    const base = emptyRelationshipForm(a.id, b.id);
    const bad = parseRelationshipForm(newId(), { ...base, startDate: "2024-13-40" }, [], true);
    expect(bad.ok).toBe(false);
    const order = parseRelationshipForm(newId(), { ...base, startDate: "2024-05-01", endDate: "2024-01-01" }, [], true);
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.errors.endDate).toBeTruthy();
    const ok = parseRelationshipForm(newId(), { ...base, startDate: "2024-01-01", endDate: "2024-05-01" }, [], true);
    expect(ok.ok).toBe(true);
  });

  it("valida la confianza como entero de 0 a 100", () => {
    const base = emptyRelationshipForm(a.id, b.id);
    for (const bad of ["abc", "1.5", "-1", "101"]) {
      const r = parseRelationshipForm(newId(), { ...base, confidence: bad }, [], true);
      expect(r.ok, bad).toBe(false);
    }
    const r = parseRelationshipForm(newId(), { ...base, confidence: "75" }, [], true);
    expect(r.ok && r.value.metadata.confidence).toBe(75);
  });

  it("ida y vuelta formulario ↔ relación", () => {
    const base = { ...emptyRelationshipForm(a.id, b.id), label: "Titular", description: "d", evidenceClass: "recorded" as const, direction: "both" as const, confidence: "10" };
    const r = parseRelationshipForm(newId(), base, [], true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(relationshipToForm(r.value)).toEqual(base);
  });
});

describe("helpers", () => {
  it("issuesToErrors atribuye metadatos y conserva el primer mensaje", () => {
    expect(
      issuesToErrors([
        { path: ["metadata", "plate"], message: "uno" },
        { path: ["metadata", "plate"], message: "dos" },
        { path: ["tags", 1], message: "etq" },
        { path: [], message: "gen" },
      ]),
    ).toEqual({ "metadata.plate": "uno", tags: "etq", _form: "gen" });
  });

  it("splitTags ignora vacíos", () => {
    expect(splitTags(" a, ,b,, ")).toEqual(["a", "b"]);
  });
});
