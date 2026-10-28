import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportExcelDialog } from "./import-dialog";

const mocks = vi.hoisted(() => ({
  downloadBytes: vi.fn(),
  buildExcelTemplate: vi.fn(),
  importExcelFile: vi.fn(),
  toast: { success: vi.fn() },
}));

vi.mock("../export/download", () => ({ downloadBytes: mocks.downloadBytes }));
vi.mock("./xlsx-workbook", async (orig) => ({
  ...(await orig<typeof import("./xlsx-workbook")>()),
  buildExcelTemplate: mocks.buildExcelTemplate,
  importExcelFile: mocks.importExcelFile,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

function setup() {
  const onClose = vi.fn();
  const onImport = vi.fn();
  render(<ImportExcelDialog open onClose={onClose} occupied={{ nodes: 0, edges: 0 }} onImport={onImport} />);
  return { onClose, onImport };
}

beforeEach(() => vi.clearAllMocks());

describe("ImportExcelDialog", () => {
  it("describe la estructura y permite descargar la plantilla", async () => {
    mocks.buildExcelTemplate.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    setup();
    expect(screen.getByText(/Una sola hoja «Grafo»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));
    await waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalled());
  });

  it("muestra los errores de fila si el Excel no es válido", async () => {
    mocks.importExcelFile.mockResolvedValue({
      ok: false,
      errors: [{ sheet: "Grafo", row: 3, field: "tipo", message: "Elige un tipo de la lista (Persona, Teléfono…)." }],
    });
    const { onImport } = setup();
    const input = screen.getByLabelText("Archivo Excel");
    const file = new File(["PK"], "datos.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Grafo fila 3/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });
});
