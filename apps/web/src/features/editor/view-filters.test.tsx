import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphSnapshot } from "@a-link/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGraphView } from "./use-graph-view";
import { ViewFilters, viewSummary } from "./view-filters";

const n = (label: string, type = "person", tags: string[] = []) => nodeInputSchema.parse({ id: randomUUID(), type, label, tags });
const a = n("Ana", "person", ["Norte"]);
const b = n("Beto", "person", ["Sur"]);
const p = n("Tel", "phone");
const e = (s: typeof a, t: typeof a, meta: Record<string, unknown> = {}) => edgeInputSchema.parse({ id: randomUUID(), sourceId: s.id, targetId: t.id, relationshipType: "contact", metadata: meta });
const doc: GraphSnapshot = {
  nodes: [a, b, p],
  edges: [e(a, b, { evidenceClass: "recorded", startDate: "2020-05-01" }), e(a, p, { evidenceClass: "observation" })],
};

function Harness() {
  const gv = useGraphView(doc, { nodeIds: [], edgeIds: [] });
  return (
    <div>
      <ViewFilters doc={doc} graphView={gv} />
      <output aria-label="visibles">{gv.result.doc.nodes.map((x) => x.label).join(",")}</output>
      <output aria-label="resumen">{viewSummary(gv, doc) ?? "todo"}</output>
      <output aria-label="aura">{gv.auraMode}</output>
    </div>
  );
}
const visibles = () => screen.getByLabelText("visibles").textContent;
const open = () => fireEvent.click(screen.getByText("Vista y filtros"));

describe("ViewFilters", () => {
  it("muestra los tipos presentes con su cuenta y todo marcado al empezar", () => {
    render(<Harness />);
    open();
    const persons = screen.getByLabelText(/Persona/);
    expect(persons).toBeChecked();
    expect(within(persons.closest("label")!).getByText("2")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Vehículo/)).toBeNull(); // sin entidades de ese tipo no se lista
    expect(visibles()).toBe("Ana,Beto,Tel");
    expect(screen.getByLabelText("resumen")).toHaveTextContent("todo");
    expect(screen.getByRole("button", { name: "Mostrar todo" })).toBeDisabled();
  });

  it("desmarcar un tipo lo oculta, lo resume y «Quitar filtros» lo devuelve", () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByLabelText(/Persona/));
    expect(visibles()).toBe("Tel");
    expect(screen.getByLabelText("resumen")).toHaveTextContent("Filtrado: 1 de 3 entidades · 0 de 2 relaciones");
    expect(screen.getByText("activos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quitar filtros/ }));
    expect(visibles()).toBe("Ana,Beto,Tel");
  });

  it("naturaleza del dato: desmarcar «observación» quita esa relación", () => {
    render(<Harness />);
    open();
    const observation = screen.getByText("Observación").closest("label")!.querySelector("input")!;
    fireEvent.click(observation);
    expect(screen.getByLabelText("resumen")).toHaveTextContent("2 de 2 relaciones".replace("2 de 2", "1 de 2"));
  });

  it("fechas: el rango filtra y «incluir sin fecha» solo se activa con rango; un rango al revés avisa", () => {
    render(<Harness />);
    open();
    const undated = screen.getByLabelText("Incluir relaciones sin fecha");
    expect(undated).toBeDisabled();
    // Una relación con solo fecha de inicio dura «desde entonces»: sigue vista con «desde 2021».
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2021-01-01" } });
    expect(undated).toBeEnabled();
    expect(screen.getByLabelText("resumen")).toHaveTextContent("2 de 2 relaciones");
    // Con «hasta 2019» la fechada (desde 2020) queda fuera y la que no tiene fecha se mantiene…
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2019-01-01" } });
    expect(screen.getByLabelText("resumen")).toHaveTextContent("1 de 2 relaciones");
    // …salvo que se desmarque «incluir sin fecha».
    fireEvent.click(undated);
    expect(screen.getByLabelText("resumen")).toHaveTextContent("0 de 2 relaciones");
    // Un «desde» posterior al «hasta» avisa.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2022-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/posterior a «hasta»/);
  });

  it("halos: el selector cambia el modo y la leyenda lista los grupos con su cuenta", () => {
    render(<Harness />);
    open();
    expect(screen.queryByRole("list", { name: "Leyenda de halos" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Halos"), { target: { value: "tag" } });
    expect(screen.getByLabelText("aura")).toHaveTextContent("tag");
    const legend = within(screen.getByRole("list", { name: "Leyenda de halos" }));
    expect(legend.getByText("Norte")).toBeInTheDocument();
    expect(legend.getByText("Sur")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Halos"), { target: { value: "type" } });
    expect(within(screen.getByRole("list", { name: "Leyenda de halos" })).getByText("Persona")).toBeInTheDocument();
  });

  it("«Mostrar todo» deshace filtros y se deshabilita", () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByLabelText(/Teléfono/));
    expect(visibles()).toBe("Ana,Beto");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todo" }));
    expect(visibles()).toBe("Ana,Beto,Tel");
    expect(screen.getByRole("button", { name: "Mostrar todo" })).toBeDisabled();
  });
});
