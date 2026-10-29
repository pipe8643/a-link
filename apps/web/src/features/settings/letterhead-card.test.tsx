import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { LetterheadCard } from "./letterhead-card";

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiBlob: vi.fn() }));

vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, api: mocks.api, apiBlob: mocks.apiBlob };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiBlob.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Recurso no encontrado."));
});

describe("LetterheadCard", () => {
  it("sin imagen propia muestra el hueco y permite elegir una", async () => {
    render(<LetterheadCard />);
    await waitFor(() => expect(mocks.apiBlob).toHaveBeenCalled());
    expect(screen.getByText("Sin imagen de fondo")).toBeInTheDocument();
    expect(screen.queryByAltText("Vista previa del fondo")).toBeNull();
    expect(screen.getByRole("button", { name: "Elegir imagen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Quitar imagen" })).toBeDisabled();
    expect(screen.getByLabelText("Elegir imagen de fondo")).toHaveAttribute("type", "file");
  });
});
