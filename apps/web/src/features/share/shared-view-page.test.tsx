import { randomUUID } from "node:crypto";
import { edgeInputSchema, nodeInputSchema, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SharedGraphExplorer } from "./shared-view-page";

const ids = vi.hoisted(() => ({
  centro: "11111111-1111-4111-8111-111111111111",
  ana: "22222222-2222-4222-8222-222222222222",
  lejano: "33333333-3333-4333-8333-333333333333",
}));

vi.mock("../editor/net-chart-canvas", () => ({
  NetChartCanvas: ({ nodesMovable, readOnly, onNodeDoubleClick }: { nodesMovable?: boolean; readOnly?: boolean; onNodeDoubleClick?(id: string): void }) => (
    <div data-testid="net-chart" data-movable={String(!!nodesMovable)} data-readonly={String(!!readOnly)}>
      <button type="button" onClick={() => onNodeDoubleClick?.(ids.centro)}>
        doble-clic-centro
      </button>
    </div>
  ),
}));

const node = (id: string, label: string, type = "person"): GraphNodeData => nodeInputSchema.parse({ id, type, label });
const edge = (a: GraphNodeData, b: GraphNodeData): GraphEdgeData =>
  edgeInputSchema.parse({ id: randomUUID(), sourceId: a.id, targetId: b.id, relationshipType: "contact", metadata: {} });

const centro = node(ids.centro, "Centro");
const ana = node(ids.ana, "Ana");
const lejano = node(ids.lejano, "Lejano");
const doc: GraphSnapshot = { nodes: [centro, ana, lejano], edges: [edge(centro, ana), edge(ana, lejano)] };

describe("SharedGraphExplorer", () => {
  it("permite mover nodos en el visor de solo lectura y retraer con doble clic", async () => {
    render(
      <SharedGraphExplorer
        graph={{ name: "Caso", expiresAt: "2026-12-01T00:00:00.000Z", doc }}
        images={new Map()}
        dark={false}
        canvasRef={createRef()}
      />,
    );
    const chart = screen.getByTestId("net-chart");
    expect(chart).toHaveAttribute("data-movable", "true");
    expect(chart).toHaveAttribute("data-readonly", "true");
    expect(screen.getByRole("heading", { name: "Categorías" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "doble-clic-centro" }));
    expect(screen.getByText(/Enfocado: 2 de 3 entidades/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/retraído/i);
  });
});
