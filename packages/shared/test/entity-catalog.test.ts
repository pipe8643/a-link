import { describe, expect, it } from "vitest";
import {
  ENTITY_CATALOG,
  ENTITY_TYPE_IDS,
  edgeMetadataSchema,
  isEntityTypeId,
  maskSensitive,
  metadataSchemaFor,
  sensitiveKeysFor,
} from "../src/index.js";

describe("catálogo de entidades", () => {
  it("define los 10 tipos iniciales con IDs estables", () => {
    expect([...ENTITY_TYPE_IDS]).toEqual([
      "person",
      "property",
      "vehicle",
      "phone",
      "social",
      "organization",
      "bank_account",
      "document",
      "location",
      "other",
    ]);
  });

  it("cada tipo tiene nombre en español, color hexadecimal, forma y campos con claves únicas", () => {
    for (const id of ENTITY_TYPE_IDS) {
      const def = ENTITY_CATALOG[id];
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.defaultColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.shape).toBeTruthy();
      const keys = def.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("la forma no es el único indicador: color y forma son distintos entre tipos", () => {
    const colors = ENTITY_TYPE_IDS.map((id) => ENTITY_CATALOG[id].defaultColor);
    const shapes = ENTITY_TYPE_IDS.map((id) => ENTITY_CATALOG[id].shape);
    expect(new Set(colors).size).toBe(colors.length);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("asigna las formas pedidas a los cinco primeros tipos", () => {
    expect(ENTITY_CATALOG.person.shape).toBe("circle");
    expect(ENTITY_CATALOG.property.shape).toBe("square");
    expect(ENTITY_CATALOG.vehicle.shape).toBe("triangle");
    expect(ENTITY_CATALOG.phone.shape).toBe("hexagon");
    expect(ENTITY_CATALOG.social.shape).toBe("diamond");
  });

  it("isEntityTypeId rechaza valores desconocidos", () => {
    expect(isEntityTypeId("person")).toBe(true);
    expect(isEntityTypeId("hacker")).toBe(false);
    expect(isEntityTypeId(undefined)).toBe(false);
  });
});

describe("validación de metadata por tipo", () => {
  it("acepta datos sintéticos válidos y descarta cadenas vacías", () => {
    const r = metadataSchemaFor("person").safeParse({ fullName: "  Persona Demo 1  ", alias: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullName).toBe("Persona Demo 1");
      expect(r.data.alias).toBeUndefined();
    }
  });

  it("rechaza claves desconocidas (esquema estricto)", () => {
    const r = metadataSchemaFor("person").safeParse({ fullName: "A", evil: "<script>" });
    expect(r.success).toBe(false);
  });

  it("valida VIN, matrícula y teléfono", () => {
    const veh = metadataSchemaFor("vehicle");
    expect(veh.safeParse({ vin: "1HGBH41JXMN109186" }).success).toBe(true);
    expect(veh.safeParse({ vin: "1HGBH41JXMN10918I" }).success).toBe(false); // contiene I
    expect(veh.safeParse({ vin: "CORTO" }).success).toBe(false);
    expect(veh.safeParse({ plate: "ABC-123" }).success).toBe(true);
    expect(veh.safeParse({ plate: "<b>" }).success).toBe(false);

    const ph = metadataSchemaFor("phone");
    expect(ph.safeParse({ number: "+00 555 0100", country: "XX", lineType: "mobile" }).success).toBe(true);
    expect(ph.safeParse({ number: "no-es-telefono" }).success).toBe(false);
    expect(ph.safeParse({ lineType: "satelital" }).success).toBe(false);
  });

  it("solo admite URLs http/https (bloquea javascript:, data: y credenciales)", () => {
    const s = metadataSchemaFor("social");
    expect(s.safeParse({ profileUrl: "https://example.com/u/demo" }).success).toBe(true);
    expect(s.safeParse({ profileUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(s.safeParse({ profileUrl: "data:text/html,<script>1</script>" }).success).toBe(false);
    expect(s.safeParse({ profileUrl: "https://user:pass@example.com" }).success).toBe(false);
    expect(s.safeParse({ profileUrl: "no es una url" }).success).toBe(false);
  });

  it("respeta la longitud máxima de cada campo", () => {
    const r = metadataSchemaFor("person").safeParse({ fullName: "x".repeat(201) });
    expect(r.success).toBe(false);
  });
});

describe("campos sensibles", () => {
  it("identifica y enmascara los campos sensibles", () => {
    expect(sensitiveKeysFor("vehicle").sort()).toEqual(["plate", "vin"]);
    const masked = maskSensitive("vehicle", { make: "Marca", plate: "ABC-123", vin: "1HGBH41JXMN109186" });
    expect(masked.make).toBe("Marca");
    expect(masked.plate).toBe("••••");
    expect(masked.vin).toBe("••••");
  });

  it("no enmascara valores vacíos", () => {
    expect(maskSensitive("vehicle", { plate: undefined }).plate).toBeUndefined();
  });
});

describe("metadatos de relaciones", () => {
  it("por defecto una relación es una hipótesis, nunca un hecho verificado", () => {
    const r = edgeMetadataSchema.parse({});
    expect(r.evidenceClass).toBe("hypothesis");
    expect(r.direction).toBe("forward");
  });

  it("valida el rango de fechas y la confianza", () => {
    expect(edgeMetadataSchema.safeParse({ startDate: "2020-01-01", endDate: "2019-01-01" }).success).toBe(false);
    expect(edgeMetadataSchema.safeParse({ startDate: "2019-01-01", endDate: "2020-01-01" }).success).toBe(true);
    expect(edgeMetadataSchema.safeParse({ confidence: 101 }).success).toBe(false);
    expect(edgeMetadataSchema.safeParse({ evidenceClass: "verified" }).success).toBe(false);
  });
});
