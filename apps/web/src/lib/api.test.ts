import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiBlob, buildQuery, isApiError, setUnauthorizedHandler } from "./api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("buildQuery", () => {
  it("omite vacíos, null y undefined y codifica los valores", () => {
    expect(buildQuery({ a: "x y", b: undefined, c: null, d: "", e: 0, f: false })).toBe("?a=x+y&e=0&f=false");
    expect(buildQuery({})).toBe("");
    expect(buildQuery(undefined)).toBe("");
  });
  it("no deja pasar caracteres que rompan la URL", () => {
    expect(buildQuery({ q: "a&b=c#d" })).toBe("?q=a%26b%3Dc%23d");
  });
});

describe("api()", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    setUnauthorizedHandler(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("solo habla con el mismo origen: ruta relativa /api/v1 y credenciales same-origin", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api("/graphs", { query: { page: 2 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/graphs?page=2");
    expect(url.startsWith("/")).toBe(true);
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined(); // GET sin cuerpo
  });

  it("envía JSON en el cuerpo con Content-Type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { graph: { id: "1" } }));
    await api("/graphs", { method: "POST", body: { name: "x" } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"x"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("204 devuelve undefined sin intentar leer el cuerpo", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("nunca guarda nada en localStorage/sessionStorage (la sesión es una cookie HttpOnly)", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: "1" } }));
    await api("/users/me");
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it("normaliza los errores del servidor en ApiError (código, mensaje, requestId, campos)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        requestId: "req-1",
        errors: [{ field: "email", rule: "isEmail" }, { nope: true }, "basura"],
      }),
    );
    const err = await api("/auth/register", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    const e = err as ApiError;
    expect(e).toMatchObject({ status: 400, code: "VALIDATION_ERROR", requestId: "req-1" });
    expect(e.fieldErrors).toEqual([{ field: "email", rule: "isEmail" }]); // descarta entradas malformadas
  });

  it("un error sin JSON (p. ej. 502 del proxy) da un mensaje genérico, no el HTML", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const e = (await api("/graphs").catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(502);
    expect(e.code).toBe("HTTP_502");
    expect(e.message).not.toContain("html");
  });

  it("fallo de red → ApiError NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const e = (await api("/graphs").catch((x: unknown) => x)) as ApiError;
    expect(e).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("un AbortError se propaga tal cual (no se muestra como error de red)", async () => {
    fetchMock.mockRejectedValue(new DOMException("abortado", "AbortError"));
    await expect(api("/graphs")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lee Retry-After de la cabecera o del cuerpo en los 429", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { code: "TOO_MANY_ATTEMPTS", message: "Demasiados intentos." }, { "Retry-After": "42" }));
    const e = (await api("/auth/login", { method: "POST", body: {} }).catch((x: unknown) => x)) as ApiError;
    expect(e.retryAfterSeconds).toBe(42);
  });

  describe("sesión caducada (401 UNAUTHENTICATED)", () => {
    it("dispara el manejador global", async () => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED", message: "No autenticado." }));
      await expect(api("/graphs")).rejects.toBeInstanceOf(ApiError);
      expect(handler).toHaveBeenCalledOnce();
    });
    it("NO lo dispara con quiet401 (comprobación inicial y login)", async () => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED", message: "No autenticado." }));
      await expect(api("/users/me", { quiet401: true })).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
    });
    it("NO lo dispara con credenciales incorrectas (es otro código)", async () => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      fetchMock.mockResolvedValue(jsonResponse(401, { code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos." }));
      await expect(api("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("api() con cuerpo binario y apiBlob()", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    setUnauthorizedHandler(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("envía el binario tal cual con su tipo y cabeceras propias, sin convertirlo a JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { file: { id: "1" } }));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await api("/graphs/g/exports", { method: "POST", binary: { data: bytes, contentType: "image/png", headers: { "X-Export-Name": "Mi%20grafo" } } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/graphs/g/exports");
    expect(init.body).toBe(bytes);
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toMatchObject({ "Content-Type": "image/png", "X-Export-Name": "Mi%20grafo", Accept: "application/json" });
  });

  it("el tipo declarado del binario no puede ser pisado por las cabeceras extra", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api("/x", { method: "POST", binary: { data: new Uint8Array([1]), contentType: "application/pdf", headers: { "Content-Type": "text/html" } } });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ "Content-Type": "application/pdf" });
  });

  it("apiBlob devuelve el contenido y usa el mismo origen y credenciales", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const blob = await apiBlob("/files/abc/content");
    expect(blob.size).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/files/abc/content");
    expect(init.credentials).toBe("same-origin");
  });

  it("apiBlob convierte los errores en ApiError (con su código) y avisa de la sesión caducada", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { code: "FILE_UNAVAILABLE", message: "El archivo ya no está disponible." }));
    await expect(apiBlob("/files/x/content")).rejects.toMatchObject({ status: 404, code: "FILE_UNAVAILABLE" });
    expect(handler).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: "UNAUTHENTICATED", message: "No autenticado." }));
    await expect(apiBlob("/files/x/content")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("apiBlob: un fallo de red es un ApiError comprensible", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiBlob("/files/x/content")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});