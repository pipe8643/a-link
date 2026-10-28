import { describe, expect, it } from "vitest";
import {
  EXCEL_GRAPH_HEADERS,
  EXCEL_SHEETS,
  excelTemplateSheet,
  foldHeader,
  graphFromExcelSheet,
  type ExcelTable,
} from "../src/excel-graph.js";

const table = (headers: string[], rows: string[][]): ExcelTable => ({ headers, rows });
const H = [...EXCEL_GRAPH_HEADERS];

describe("graphFromExcelSheet", () => {
  it("convierte la plantilla de ejemplo en un grafo válido", () => {
    const spec = excelTemplateSheet();
    const r = graphFromExcelSheet({ headers: spec.headers, rows: spec.rows });
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes.map((n) => n.label).sort()).toEqual(["+34 600 000 000", "Acme SL", "Ana Pérez"]);
    expect(r.value.edges).toHaveLength(2);
    expect(r.value.edges.map((e) => e.relationshipType).sort()).toEqual(["commercial", "contact"]);
  });

  it("repite la ref para añadir más enlaces y acepta nombres en español", () => {
    const r = graphFromExcelSheet(
      table(H, [
        ["a", "person", "Ana", "", "", "b", "Contacto", "", "Dato registrado", "ambos"],
        ["a", "", "", "", "", "c", "Familiar", "", "", ""],
        ["b", "Teléfono", "Móvil", "", "", "", "", "", "", ""],
        ["c", "Persona", "Luis", "", "", "", "", "", "", ""],
      ]),
    );
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes).toHaveLength(3);
    expect(r.value.edges).toHaveLength(2);
    expect(r.value.edges[0]?.metadata).toMatchObject({ evidenceClass: "recorded", direction: "both" });
  });

  it("hereda la ref de la fila anterior si se deja vacía", () => {
    const r = graphFromExcelSheet(
      table(H, [
        ["ana", "Persona", "Ana", "", "", "tel1", "Contacto", "", "", ""],
        ["", "", "", "", "", "acme", "Relación comercial", "", "", ""],
        ["tel1", "Teléfono", "Tel", "", "", "", "", "", "", ""],
        ["acme", "Organización o empresa", "Acme", "", "", "", "", "", "", ""],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.edges).toHaveLength(2);
  });

  it("rechaza un enlace a una ref que no existe", () => {
    const r = graphFromExcelSheet(table(["ref", "tipo", "nombre", "enlace_con", "tipo_enlace"], [["a", "Persona", "Ana", "fantasma", "Contacto"]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "enlace_con" && e.sheet === EXCEL_SHEETS.graph)).toBe(true);
  });

  it("trata SQL/HTML como texto en el nombre", () => {
    const r = graphFromExcelSheet(table(["ref", "tipo", "nombre"], [["x", "Persona", "<script>alert(1)</script>"]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes[0]?.label).toBe("<script>alert(1)</script>");
  });

  it("exige las columnas mínimas", () => {
    const r = graphFromExcelSheet(table(["foo"], [["1"]]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field).sort()).toEqual(["nombre", "ref", "tipo"]);
  });

  it("si el nombre está vacío usa la ref", () => {
    const r = graphFromExcelSheet(table(["ref", "tipo", "nombre"], [["320550987", "Teléfono", ""]]));
    expect(r.ok, r.ok ? "" : JSON.stringify(r.errors)).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes[0]?.label).toBe("320550987");
  });

  it("numera las filas a partir de la cabecera real (fila 2 si hay ayuda encima)", () => {
    const r = graphFromExcelSheet({
      headers: ["ref", "tipo", "nombre"],
      rows: [["", "Persona", "Ana"]],
      headerRow: 2,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.row).toBe(3);
  });
});

describe("plantilla", () => {
  it("tiene pocas columnas y ayuda breve", () => {
    expect(EXCEL_GRAPH_HEADERS).toHaveLength(10);
    expect(excelTemplateSheet().help.includes("enlace_con")).toBe(true);
    expect(foldHeader("origen→destino")).toBe("origendestino");
  });
});
