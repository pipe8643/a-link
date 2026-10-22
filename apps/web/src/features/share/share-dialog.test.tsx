import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse, mockApi, newQueryClient } from "@/test/render";
import { ShareDialog } from "./share-dialog";

const TOKEN = "B".repeat(43);
const GRAPH = "11111111-1111-4111-8111-111111111111";
type Row = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastViewedAt: string | null; viewCount: number; status: "active" | "expired" | "revoked" };
const SHARE: Row = {
  id: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-03-01T00:00:00.000Z",
  expiresAt: "2026-03-08T00:00:00.000Z",
  revokedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  status: "active",
};

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  let items: Row[] = [];
  mockApi({
    [`GET /api/v1/graphs/${GRAPH}/shares`]: () => jsonResponse(200, { items }),
    [`POST /api/v1/graphs/${GRAPH}/shares`]: () => {
      items = [SHARE];
      return jsonResponse(201, { share: SHARE, token: TOKEN });
    },
    [`DELETE /api/v1/graphs/${GRAPH}/shares/${SHARE.id}`]: () => {
      items = [{ ...SHARE, status: "revoked", revokedAt: "2026-03-02T00:00:00.000Z" }];
      return new Response(null, { status: 204 });
    },
  });
  render(
    <QueryClientProvider client={newQueryClient()}>
      <ShareDialog open onClose={vi.fn()} graphId={GRAPH} />
    </QueryClientProvider>,
  );
  return { writeText };
}

describe("ShareDialog", () => {
  it("crea un enlace, lo muestra una vez y lo copia", async () => {
    const { writeText } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));
    const field = await screen.findByLabelText("Enlace de solo lectura");
    expect((field as HTMLInputElement).value).toBe(`${window.location.origin}/s#${TOKEN}`);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s#${TOKEN}`);
    expect(await screen.findByText(/Caduca el/)).toBeInTheDocument();
  });

  it("revoca un enlace activo", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));
    await userEvent.click(await screen.findByRole("button", { name: "Revocar" }));
    await waitFor(() => expect(screen.getByText("Revocado")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Revocar" })).toBeNull();
  });
});
