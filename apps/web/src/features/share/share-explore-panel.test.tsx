import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useGraphView } from "../editor/use-graph-view";
import { ShareExplorePanel } from "./share-explore-panel";

const node = (label: string, type = "person"): GraphNodeData => nodeInputSchema.parse({ id: randomUUID(), type, label });
const edge = (a: GraphNodeData, b: GraphNodeData): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact", metadata: {} });

const ana = node("Ana");
const tel = node("Tel 555", "phone");
const doc: GraphSnapshot = { nodes: [ana, tel], edges: [edge(ana, tel)] };

function Harness() {
  const graphView = useGraphView(doc, { nodeIds: [], edgeIds: [] });
  return <ShareExplorePanel doc={doc} graphView={graphView} />;
}

describe("ShareExplorePanel", () => {
  it("muestra las categorías presentes y al desactivar una filtra la vista", async () => {
    render(<Harness />);
    const phone = screen.getByRole("button", { name: /Teléfono/ });
    expect(phone).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(phone);
    expect(phone).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Filtrado: 1 de 2 entidades/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mostrar todo" }));
    expect(screen.getByRole("button", { name: /Teléfono/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("explica arrastre y doble clic", () => {
    render(<Harness />);
    expect(screen.getByText(/Arrastra las entidades/)).toBeInTheDocument();
    expect(screen.getByText(/Doble clic/)).toBeInTheDocument();
  });
});
