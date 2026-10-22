/**
 * Cliente HTTP de la API. Decisiones de seguridad:
 *  - Solo habla con el MISMO origen (`/api/v1`); el navegador adjunta la cookie HttpOnly de sesión.
 *  - Nunca guarda tokens en JS (localStorage/sessionStorage): la sesión no es accesible desde scripts.
 *  - Los errores se normalizan en `ApiError`; los mensajes del servidor ya vienen en español y sin datos internos.
 */

export const API_BASE = "/api/v1";

export interface FieldIssue {
  field: string;
  rule: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fieldErrors: FieldIssue[] = [],
    readonly retryAfterSeconds?: number,
    /** Datos no sensibles que el servidor adjunta para recuperarse del error (p. ej. `currentRevision`). */
    readonly details: Record<string, number | string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401 && this.code === "UNAUTHENTICATED";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Cuerpo binario (subida de un fichero). Excluye `body`. */
  binary?: { data: Blob | Uint8Array; contentType: string; headers?: Record<string, string> };
  query?: Query;
  signal?: AbortSignal;
  /** No dispara el manejador global de "sesión caducada" (login, comprobación inicial de sesión). */
  quiet401?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;
/** La aplicación registra aquí qué hacer cuando la sesión deja de ser válida a mitad de uso. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const NETWORK_MESSAGE = "No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
const GENERIC_MESSAGE = "Ha ocurrido un error inesperado. Inténtalo de nuevo.";

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* el cuerpo no es JSON (p. ej. error del proxy) */
  }
  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof obj.code === "string" ? obj.code : `HTTP_${res.status}`;
  const message = typeof obj.message === "string" && obj.message ? obj.message : GENERIC_MESSAGE;
  const errors = Array.isArray(obj.errors)
    ? (obj.errors as unknown[]).filter(
        (e): e is FieldIssue =>
          typeof e === "object" && e !== null && typeof (e as FieldIssue).field === "string" && typeof (e as FieldIssue).rule === "string",
      )
    : [];
  const retryAfter =
    typeof obj.retryAfterSeconds === "number"
      ? obj.retryAfterSeconds
      : Number(res.headers.get("Retry-After")) || undefined;
  return new ApiError(
    res.status,
    code,
    message,
    typeof obj.requestId === "string" ? obj.requestId : (res.headers.get("X-Request-Id") ?? undefined),
    errors,
    retryAfter,
    typeof obj.details === "object" && obj.details !== null && !Array.isArray(obj.details) ? (obj.details as Record<string, number | string>) : {},
  );
}

async function send(path: string, init: RequestInit, query: Query | undefined, quiet401: boolean | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(query)}`, { ...init, credentials: "same-origin" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_MESSAGE);
  }

  if (!res.ok) {
    const error = await toApiError(res);
    if (error.isUnauthenticated && !quiet401) unauthorizedHandler?.();
    throw error;
  }
  return res;
}

export async function api<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, binary, query, signal, quiet401 } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (binary) {
    // Subida de un fichero: el cuerpo es el binario tal cual; el servidor valida su contenido real.
    Object.assign(headers, binary.headers, { "Content-Type": binary.contentType });
    payload = binary.data as BodyInit;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await send(path, { method, headers, body: payload, signal }, query, quiet401);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Descarga un recurso binario autenticado (p. ej. un archivo guardado) como `Blob`. Los errores llegan como `ApiError`. */
export async function apiBlob(path: string, options: { query?: Query; signal?: AbortSignal } = {}): Promise<Blob> {
  const res = await send(path, { method: "GET", headers: { Accept: "*/*" }, signal: options.signal }, options.query, undefined);
  return res.blob();
}
