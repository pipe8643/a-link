import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockApi } from "@/test/render";
import { downloadStoredFile, storedFileName, uploadExport } from "./queries";

const mocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("../export/download", () => ({ downloadBlob: mocks.downloadBlob }));

beforeEach(() => vi.clearAllMocks());

describe("storedFileName", () => {
  it("añade la extensión real del formato (JPEG → .jpg)", () => {
    expect(storedFileName({ name: "a", format: "png" })).toBe("a.png");
    expect(storedFileName({ name: "a", format: "jpeg" })).toBe("a.jpg");
    expect(storedFileName({ name: "a", format: "pdf" })).toBe("a.pdf");
    expect(storedFileName({ name: "a", format: "pptx" })).toBe("a.pptx");
  });
});

describe("uploadExport", () => {
  it("envía el binario crudo con su tipo, el nombre codificado en cabecera (no en la URL) y devuelve el archivo", async () => {
    const stored = { id: "f1" };
    const fetchMock = mockApi({ "POST /api/v1/graphs/g1/exports": () => jsonResponse(201, { file: stored }) });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await expect(uploadExport("g1", bytes, "image/png", "Ñandú / informe #1.png")).resolves.toEqual(stored);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/graphs/g1/exports");
    expect(url).not.toContain("andu");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bytes);
    expect(init.credentials).toBe("same-origin");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("image/png");
    expect(decodeURIComponent(headers.get("X-Export-Name")!)).toBe("Ñandú / informe #1.png");
    expect(headers.get("X-Export-Name")).not.toMatch(/[^\x20-\x7e]/);
  });

  it("propaga el error del servidor para que quien llama pueda avisar", async () => {
    mockApi({ "POST /api/v1/graphs/g1/exports": () => jsonResponse(413, { code: "FILE_TOO_LARGE", message: "El archivo supera el tamaño máximo." }) });
    await expect(uploadExport("g1", new Uint8Array([1]), "image/png", "x.png")).rejects.toMatchObject({ status: 413, message: "El archivo supera el tamaño máximo." });
  });
});

describe("downloadStoredFile", () => {
  it("pide el contenido y lo guarda con el nombre y la extensión del formato", async () => {
    mockApi({ "GET /api/v1/files/f1/content": () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }) });
    await downloadStoredFile({ id: "f1", name: "Foto", format: "jpeg" });
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = mocks.downloadBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("Foto.jpg");
    expect(blob.size).toBe(3);
  });

  it("si el servidor responde 404 no guarda nada y lanza el error", async () => {
    mockApi({ "GET /api/v1/files/f1/content": () => jsonResponse(404, { code: "FILE_NOT_FOUND", message: "No encontrado." }) });
    await expect(downloadStoredFile({ id: "f1", name: "x", format: "pdf" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});