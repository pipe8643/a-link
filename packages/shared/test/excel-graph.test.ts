import { describe, expect, it } from "vitest";
import {
  EXCEL_ENTITY_HEADERS,
  EXCEL_SHEETS,
  excelTemplateTables,
  foldHeader,
  graphFromExcelTables,
  type ExcelTable,
} from "../src/excel-graph.js";

const table = (headers: string[], rows: string[][]): ExcelTable => ({ headers, rows });

describe("graphFromExcelTables", () => {
  it("convierte la plantilla de ejemplo en un grafo válido", () => {
    const { entities, relations } = excelTemplateTables();
    const r = graphFromExcelTables(entities, relations);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes.map((n) => n.label).sort()).toEqual(["+34 600 000 000", "Acme SL", "Ana Pérez"]);
    expect(r.value.nodes.find((n) => n.type === "phone")?.metadata.number).toBe("+34 600 000 000");
    expect(r.value.edges).toHaveLength(2);
    expect(r.value.edges.map((e) => e.relationshipType).sort()).toEqual(["commercial", "contact"]);
  });

  it("acepta identificadores internos y etiquetas en español", () => {
    const entities = table(
      ["ref", "tipo", "nombre"],
      [
        ["a", "person", "Ana"],
        ["b", "Teléfono", "Móvil"],
      ],
    );
    const relations = table(
      ["origen", "destino", "tipo", "naturaleza", "direccion"],
      [["a", "b", "Contacto", "Dato registrado", "ambos"]],
    );
    const r = graphFromExcelTables(entities, relations);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.edges[0]).toMatchObject({ relationshipType: "contact" });
    expect(r.value.edges[0]?.metadata).toMatchObject({ evidenceClass: "recorded", direction: "both" });
  });

  it("rechaza javascript: en URL, refs duplicadas y relaciones huérfanas", () => {
    const entities = table(
      ["ref", "tipo", "nombre", "profileUrl"],
      [
        ["a", "Red social", "Perfil", "javascript:alert(1)"],
        ["a", "Persona", "Otra", ""],
      ],
    );
    const relations = table(
      ["origen", "destino", "tipo"],
      [["a", "no-existe", "Contacto"]],
    );
    const r = graphFromExcelTables(entities, relations);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "ref")).toBe(true);
    expect(r.errors.some((e) => e.sheet === EXCEL_SHEETS.relations)).toBe(true);
  });

  it("trata SQL/HTML como texto en el nombre", () => {
    const entities = table(["ref", "tipo", "nombre"], [["x", "Persona", "<script>alert(1)</script>"]]);
    const r = graphFromExcelTables(entities, { headers: [], rows: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes[0]?.label).toBe("<script>alert(1)</script>");
  });

  it("exige las columnas mínimas", () => {
    const r = graphFromExcelTables(table(["foo"], [["1"]]), { headers: [], rows: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field).sort()).toEqual(["foo", "nombre", "ref", "tipo"]);
  });
});

describe("plantilla", () => {
  it("incluye las columnas estables y tipos documentados", () => {
    expect(EXCEL_ENTITY_HEADERS[0]).toBe("ref");
    expect(excelTemplateTables().instructions.some((row) => row[0]?.includes("Persona"))).toBe(true);
    expect(foldHeader("origen→destino")).toBe("origendestino");
  });
});
