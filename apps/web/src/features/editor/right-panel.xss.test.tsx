import { randomUUID } from "node:crypto";
import { nodeInputSchema, type GraphNodeData } from "@a-link/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RightPanel } from "./right-panel";
import type { EditorApi } from "./use-editor";

const PAYLOAD = "<img src=x onerror=alert(1)>";

function editorWith(node: GraphNodeData): EditorApi {
  return {
    doc: { nodes: [node], edges: [] },
    selection: { nodeIds: [node.id], edgeIds: [] },
    nodesById: new Map([[node.id, node]]),
    edgesById: new Map(),
    updateEntity: vi.fn(),
  } as unknown as EditorApi;
}

describe("RightPanel: XSS", () => {
  it("muestra el nombre de la entidad como texto, no como HTML", () => {
    const node = nodeInputSchema.parse({ id: randomUUID(), type: "person", label: PAYLOAD });
    render(
      <RightPanel
        graphId={randomUUID()}
        editor={editorWith(node)}
        onConnectFrom={vi.fn()}
        onEditEdge={vi.fn()}
        onDelete={vi.fn()}
        onPickEdge={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: PAYLOAD })).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
