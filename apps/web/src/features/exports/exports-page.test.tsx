import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockApi, renderRoutes } from "@/test/render";
import { ExportsPage } from "./exports-page";
import type { StoredFile } from "./queries";

const mocks = vi.hoisted(() => ({ downloadBlob: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../export/download", () => ({ downloadBlob: mocks.downloadBlob, downloadBytes: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: vi.fn() } }));

const file = (over: Partial<StoredFile> = {}): StoredFile => ({
  id: crypto.randomUUID(),
  graphId: crypto.randomUUID(),
  graphName: "Caso Alfa",
  graphTrashed: false,
  folderId: null,
  name: "Informe",
  format: "pdf",
  fileSize: 1.5 * 1024 * 1024,
  sha256: "a".repeat(64),
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
  ...over,
});

const page = (items: StoredFile[], total = items.length, p = 1) => ({ items, page: p, pageSize: 20, total });
const renderPage = () => renderRoutes([{ path: "/", element: <ExportsPage /> }]);
const lastListQuery = (fetchMock: ReturnType<typeof mockApi>) => {
  const calls = fetchMock.mock.calls.filter(([u, init]) => new URL(String(u), "http://x").pathname === "/api/v1/files" && (init as RequestInit | undefined)?.method === "GET");
  const url = new URL(String(calls.at(-1)![0]), "http://x");
  return Object.fromEntries(url.searchParams);
};

beforeEach(() => vi.clearAllMocks());

describe("ExportsPage", () => {
  it("lista los archivos con nombre y extensión, grafo de origen, formato, tamaño y fecha", async () => {
    const f = file({ name: "Informe final", format: "pdf" });
    mockApi({ "GET /api/v1/files": () => jsonResponse(200, page([f])) });
    renderPage();
    const list = await screen.findByRole("list", { name: "Exportaciones guardadas" });
    const row = within(list).getAllByRole("listitem")[0]!;
    expect(row).toHaveTextContent("Informe final.pdf");
    expect(within(row).getByRole("link", { name: "Caso Alfa" })).toHaveAttribute("href", `/graphs/${f.graphId}`);
    expect(row).toHaveTextContent("1,5 MB");
    expect(row).toHaveTextContent("PDF");
    expect(screen.getByText("1 exportación")).toBeInTheDocument();
  });

  it("el JPEG se descarga como .jpg y un grafo en la papelera no es un enlace", async () => {
    mockApi({
      "GET /api/v1/files": () => jsonResponse(200, page([file({ name: "Foto", format: "jpeg" }), file({ name: "Vieja", format: "png", graphName: "Borrado", graphTrashed: true })])),
    });
    renderPage();
    expect(await screen.findByText("Foto.jpg")).toBeInTheDocument();
    expect(screen.getByText("Vieja.png")).toBeInTheDocument();
    expect(screen.getByText(/Borrado \(en la papelera\)/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Borrado" })).toBeNull();
  });

  it("sin archivos explica cómo guardar el primero; con filtros dice que nada coincide", async () => {
    const fetchMock = mockApi({ "GET /api/v1/files": () => jsonResponse(200, page([])) });
    renderPage();
    expect(await screen.findByText("Aún no has guardado exportaciones")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar exportaciones"), { target: { value: "zzz" } });
    expect(await screen.findByText("Ninguna exportación coincide")).toBeInTheDocument();
    expect(lastListQuery(fetchMock)).toMatchObject({ search: "zzz" });
  });

  it("buscar y filtrar por formato consultan al servidor y vuelven a la primera página", async () => {
    const fetchMock = mockApi({ "GET /api/v1/files": () => jsonResponse(200, page([file()], 45)) });
    renderPage();
    await screen.findByText("Informe.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await waitFor(() => expect(lastListQuery(fetchMock)).toMatchObject({ page: "2", pageSize: "20" }));

    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "png" } });
    await waitFor(() => expect(lastListQuery(fetchMock)).toMatchObject({ format: "png", page: "1" }));
    fireEvent.change(screen.getByLabelText("Buscar exportaciones"), { target: { value: "  caso  " } });
    await waitFor(() => expect(lastListQuery(fetchMock)).toMatchObject({ search: "caso", format: "png", page: "1" }));
  });

  it("descargar pide el contenido autenticado y lo guarda con el nombre y la extensión correctos", async () => {
    const f = file({ name: "Resumen", format: "pptx" });
    const fetchMock = mockApi({
      "GET /api/v1/files": () => jsonResponse(200, page([f])),
      [`GET /api/v1/files/${f.id}/content`]: () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Descargar Resumen.pptx" }));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, name] = mocks.downloadBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("Resumen.pptx");
    expect(blob.size).toBe(3);
    expect(fetchMock.mock.calls.some(([u, init]) => String(u) === `/api/v1/files/${f.id}/content` && (init as RequestInit).credentials === "same-origin")).toBe(true);
  });

  it("si la descarga falla avisa con el motivo y no guarda nada", async () => {
    const f = file();
    mockApi({
      "GET /api/v1/files": () => jsonResponse(200, page([f])),
      [`GET /api/v1/files/${f.id}/content`]: () => jsonResponse(404, { code: "FILE_UNAVAILABLE", message: "El archivo ya no está disponible. Puedes eliminarlo de la lista." }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Descargar/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("El archivo ya no está disponible. Puedes eliminarlo de la lista."));
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it("renombrar envía solo el nombre nuevo (sin extensión) y refresca la lista", async () => {
    const f = file({ name: "Viejo" });
    let current = f;
    let patched: unknown;
    mockApi({
      "GET /api/v1/files": () => jsonResponse(200, page([current])),
      [`PATCH /api/v1/files/${f.id}`]: (init) => {
        patched = JSON.parse(String(init.body));
        current = { ...f, name: "Nuevo" };
        return jsonResponse(200, { file: current });
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Renombrar Viejo.pdf" }));
    const input = screen.getByLabelText("Nombre");
    expect(input).toHaveValue("Viejo");
    fireEvent.change(input, { target: { value: "  Nuevo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Nuevo.pdf")).toBeInTheDocument();
    expect(patched).toEqual({ name: "Nuevo" });
    expect(mocks.success).toHaveBeenCalledWith("Exportación renombrada");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renombrar: un nombre vacío no se envía y un error del servidor se muestra sin cerrar el diálogo", async () => {
    const f = file({ name: "Viejo" });
    const patch = vi.fn(() => jsonResponse(400, { code: "VALIDATION_FAILED", message: "Datos no válidos." }));
    mockApi({ "GET /api/v1/files": () => jsonResponse(200, page([f])), [`PATCH /api/v1/files/${f.id}`]: patch });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Renombrar/ }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escribe un nombre.")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Otro" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("eliminar pide confirmación; al confirmar borra y refresca, y cancelar no borra nada", async () => {
    const f = file({ name: "Borrame" });
    let items = [f];
    const del = vi.fn(() => {
      items = [];
      return new Response(null, { status: 204 });
    });
    mockApi({ "GET /api/v1/files": () => jsonResponse(200, page(items)), [`DELETE /api/v1/files/${f.id}`]: del });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Eliminar Borrame.pdf" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Eliminar «Borrame.pdf»");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar Borrame.pdf" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Aún no has guardado exportaciones")).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("Exportación eliminada");
  });

  it("si falla el listado muestra el error y permite reintentar", async () => {
    let fail = true;
    mockApi({
      "GET /api/v1/files": () => (fail ? jsonResponse(500, { code: "INTERNAL_ERROR", message: "Error interno del servidor." }) : jsonResponse(200, page([file()]))),
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Informe.pdf")).toBeInTheDocument();
  });
});
