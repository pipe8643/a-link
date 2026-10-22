import { nodeInputSchema } from "@a-link/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./export-dialog";

const mocks = vi.hoisted(() => ({ runExport: vi.fn(), downloadBytes: vi.fn(), toast: vi.fn(), warning: vi.fn(), uploadExport: vi.fn(), createShare: vi.fn() }));

vi.mock("./run-export", async (orig) => ({ ...(await orig<typeof import("./run-export")>()), runExport: mocks.runExport }));
vi.mock("./download", () => ({ downloadBytes: mocks.downloadBytes }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast, warning: mocks.warning } }));
vi.mock("../exports/queries", () => ({ uploadExport: mocks.uploadExport }));
vi.mock("../share/queries", () => ({ createShare: mocks.createShare }));

const doc = { nodes: [nodeInputSchema.parse({ id: crypto.randomUUID(), type: "person", label: "Ana" })], edges: [] };

function setup(over: Partial<React.ComponentProps<typeof ExportDialog>> = {}) {
  const onClose = vi.fn();
  render(<ExportDialog open onClose={onClose} graphName="Mi grafo" doc={doc} dark={false} canvas={createRef()} {...over} />);
  return { onClose };
}
const exportButton = () => screen.getByRole("button", { name: "Exportar" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ExportDialog", () => {
  it("propone el nombre del grafo como nombre de archivo y los valores por defecto", () => {
    setup();
    expect(screen.getByLabelText("Nombre del archivo")).toHaveValue("Mi grafo");
    expect(screen.getByLabelText("Formato")).toHaveValue("png");
  });

  it("exporta, descarga y cierra", async () => {
    mocks.runExport.mockResolvedValue({ bytes: new Uint8Array([1]), mime: "image/png", fileName: "Mi grafo.png", notes: [] });
    const { onClose } = setup();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", "Mi grafo.png"));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.runExport.mock.calls[0]![0]).toMatchObject({ graphName: "Mi grafo", options: { format: "png", background: "white" } });
  });

  it("si falla muestra el motivo, no descarga y deja reintentar o cambiar de formato", async () => {
    mocks.runExport.mockRejectedValueOnce(new Error("ZoomCharts no inicializó el lienzo"));
    const { onClose } = setup();
    fireEvent.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo exportar: ZoomCharts no inicializó el lienzo");
    expect(mocks.downloadBytes).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(exportButton()).toBeEnabled();
  });

  it("«transparente» solo se ofrece en PNG y el fondo se corrige al cambiar de formato", async () => {
    mocks.runExport.mockResolvedValue({ bytes: new Uint8Array([1]), mime: "image/jpeg", fileName: "x.jpg", notes: [] });
    setup();
    fireEvent.change(screen.getByLabelText("Fondo"), { target: { value: "transparent" } });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "jpeg" } });
    expect(screen.getByLabelText("Fondo").querySelectorAll("option")).toHaveLength(2);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalled());
    expect(mocks.runExport.mock.calls[0]![0].options.background).toBe("white");
  });

  it("cancelar mientras genera aborta la operación y no descarga nada", async () => {
    let signal: AbortSignal | undefined;
    mocks.runExport.mockImplementation(
      ({ signal: s }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(new DOMException("cancelada", "AbortError")));
        }),
    );
    const { onClose } = setup();
    fireEvent.click(exportButton());
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
    await Promise.resolve();
    expect(mocks.downloadBytes).not.toHaveBeenCalled();
  });

  it("PowerPoint editable no se ofrece para un grafo demasiado grande", () => {
    const many = Array.from({ length: 401 }, (_, i) => nodeInputSchema.parse({ id: crypto.randomUUID(), type: "person", label: `n${i}` }));
    setup({ doc: { nodes: many, edges: [] } });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "pptx-editable" } });
    expect(exportButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/supera el máximo/);
  });

  it("con el grafo vacío no se puede exportar", () => {
    setup({ doc: { nodes: [], edges: [] } });
    expect(exportButton()).toBeDisabled();
  });
});

describe("ExportDialog · vista filtrada y halos", () => {
  const other = nodeInputSchema.parse({ id: crypto.randomUUID(), type: "person", label: "Beto" });
  const full = { nodes: [...doc.nodes, other], edges: [] };
  const okResult = { bytes: new Uint8Array([1]), mime: "image/png", fileName: "x.png", notes: [] };

  it("sin filtros no pregunta qué exportar ni añade nota", async () => {
    mocks.runExport.mockResolvedValue(okResult);
    setup({ doc: full, viewDoc: full });
    expect(screen.queryByLabelText("Qué exportar")).toBeNull();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalled());
    expect(mocks.runExport.mock.calls[0]![0].doc).toBe(full);
    expect(mocks.runExport.mock.calls[0]![0].viewNote).toBeUndefined();
  });

  it("con filtros propone lo visible, lo anota y deja elegir el grafo completo", async () => {
    mocks.runExport.mockResolvedValue(okResult);
    setup({ doc: full, viewDoc: doc });
    const scope = screen.getByLabelText("Qué exportar");
    expect(scope).toHaveValue("visible");
    expect(scope).toHaveTextContent("1 de 2 entidades");
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalledTimes(1));
    expect(mocks.runExport.mock.calls[0]![0]).toMatchObject({ viewNote: "Vista filtrada: 1 de 2 entidades" });
    expect(mocks.runExport.mock.calls[0]![0].doc).toBe(doc);

    mocks.runExport.mockClear();
    fireEvent.change(scope, { target: { value: "all" } });
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalledTimes(1));
    expect(mocks.runExport.mock.calls[0]![0].doc).toBe(full);
    expect(mocks.runExport.mock.calls[0]![0].viewNote).toBeUndefined();
  });

  it("los halos activos se incluyen por defecto, se pueden quitar y no aplican a PowerPoint editable", async () => {
    mocks.runExport.mockResolvedValue(okResult);
    setup({ auraMode: "tag" });
    const check = screen.getByLabelText(/Incluir halos \(halos por etiqueta\)/);
    expect(check).toBeChecked();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalledTimes(1));
    expect(mocks.runExport.mock.calls[0]![0].auraMode).toBe("tag");

    mocks.runExport.mockClear();
    fireEvent.click(check);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalledTimes(1));
    expect(mocks.runExport.mock.calls[0]![0].auraMode).toBe("none");

    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "pptx-editable" } });
    expect(screen.queryByLabelText(/Incluir halos/)).toBeNull();
    expect(screen.getByText(/no incluye los halos/)).toBeInTheDocument();
  });

  it("sin halos activos no se ofrece la opción", () => {
    setup();
    expect(screen.queryByLabelText(/Incluir halos/)).toBeNull();
  });
});

describe("ExportDialog · copia privada en la cuenta", () => {
  const ok = { bytes: new Uint8Array([1, 2]), mime: "image/png", fileName: "Mi grafo.png", notes: [] };
  const copyBox = () => screen.getByLabelText("Guardar una copia en mi cuenta (Exportaciones)");

  it("la opción solo aparece si el grafo está guardado (hay graphId) y empieza desactivada", () => {
    setup();
    expect(screen.queryByLabelText(/Guardar una copia en mi cuenta/)).toBeNull();
  });

  it("desactivada por defecto: se descarga y NO se sube nada", async () => {
    mocks.runExport.mockResolvedValue(ok);
    setup({ graphId: "g1" });
    expect(copyBox()).not.toBeChecked();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalled());
    expect(mocks.uploadExport).not.toHaveBeenCalled();
  });

  it("marcada: descarga primero, sube el mismo contenido, avisa y refresca", async () => {
    const order: string[] = [];
    mocks.runExport.mockResolvedValue(ok);
    mocks.downloadBytes.mockImplementation(() => order.push("download"));
    const saved = { id: "f1" };
    mocks.uploadExport.mockImplementation(async () => {
      order.push("upload");
      return saved;
    });
    const onSaved = vi.fn();
    const { onClose } = setup({ graphId: "g1", onSaved });
    fireEvent.click(copyBox());
    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(order).toEqual(["download", "upload"]);
    expect(mocks.uploadExport).toHaveBeenCalledWith("g1", ok.bytes, "image/png", "Mi grafo.png", expect.any(AbortSignal));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("se guardó una copia"), expect.anything());
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("si la subida falla, la descarga ya se hizo: avisa con el motivo, no refresca y cierra", async () => {
    mocks.runExport.mockResolvedValue(ok);
    mocks.uploadExport.mockRejectedValue(new Error("sin conexión"));
    const onSaved = vi.fn();
    const { onClose } = setup({ graphId: "g1", onSaved });
    fireEvent.click(copyBox());
    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.downloadBytes).toHaveBeenCalledTimes(1);
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("no se pudo guardar la copia"), expect.anything());
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("cancelar durante la subida la aborta y no avisa de éxito ni de fallo", async () => {
    mocks.runExport.mockResolvedValue(ok);
    let signal: AbortSignal | undefined;
    mocks.uploadExport.mockImplementation(
      (_g: string, _b: Uint8Array, _m: string, _n: string, s: AbortSignal) =>
        new Promise((_, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(new DOMException("cancelada", "AbortError")));
        }),
    );
    const { onClose } = setup({ graphId: "g1" });
    fireEvent.click(copyBox());
    fireEvent.click(exportButton());
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
    await Promise.resolve();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe("ExportDialog · PowerPoint interactivo", () => {
  const TOKEN = "C".repeat(43);
  const pptx = { bytes: new Uint8Array([1]), mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileName: "Mi grafo.pptx", notes: [] };

  it("sin graphId no se puede exportar en este formato", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "pptx-live" } });
    expect(exportButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/grafo guardado/);
    expect(mocks.createShare).not.toHaveBeenCalled();
  });

  it("crea el enlace de 7 días y se lo pasa a runExport", async () => {
    mocks.createShare.mockResolvedValue({
      token: TOKEN,
      share: { id: "s1", createdAt: "2026-03-01T00:00:00Z", expiresAt: "2026-03-08T00:00:00Z", revokedAt: null, lastViewedAt: null, viewCount: 0, status: "active" },
    });
    mocks.runExport.mockResolvedValue(pptx);
    setup({ graphId: "g1" });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "pptx-live" } });
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.runExport).toHaveBeenCalled());
    expect(mocks.createShare).toHaveBeenCalledWith("g1", 7, expect.any(AbortSignal));
    expect(mocks.runExport.mock.calls[0]![0].liveShare).toEqual({
      url: `${window.location.origin}/s#${TOKEN}`,
      expiresAt: new Date("2026-03-08T00:00:00Z"),
    });
    expect(mocks.downloadBytes).toHaveBeenCalled();
  });
});