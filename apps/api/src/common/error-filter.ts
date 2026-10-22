import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import "./request-context.js";

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Solicitud no válida.",
  401: "No autenticado.",
  403: "Acceso denegado.",
  404: "Recurso no encontrado.",
  405: "Método no permitido.",
  409: "La operación entra en conflicto con el estado actual.",
  413: "La solicitud es demasiado grande.",
  415: "Tipo de contenido no admitido.",
  422: "Los datos no se pueden procesar.",
  429: "Demasiadas solicitudes. Inténtalo de nuevo más tarde.",
};

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  errors?: Array<{ field: string; rule: string }>;
  details?: Record<string, number | string>;
  retryAfterSeconds?: number;
}

/**
 * Describe un error SIN filtrar datos: los errores de Prisma/MySQL pueden incluir valores de la
 * consulta (correos, tokens...). Solo se registra el tipo y códigos técnicos.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return `${err.name}${typeof code === "string" ? ` [${code}]` : ""}`;
  }
  return typeof err;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errores");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? "n/a";

    let statusCode = 500;
    let code = "INTERNAL_ERROR";
    let message = "Error interno del servidor.";
    let errors: ApiErrorBody["errors"];
    let retryAfterSeconds: number | undefined;
    let details: Record<string, number | string> | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      // Solo se reutiliza el mensaje/código si los puso NUESTRO código (campo `code` presente).
      if (typeof obj.code === "string") {
        code = obj.code;
        if (typeof obj.message === "string") message = obj.message;
        if (Array.isArray(obj.errors)) errors = obj.errors as ApiErrorBody["errors"];
        if (typeof obj.retryAfterSeconds === "number") retryAfterSeconds = obj.retryAfterSeconds;
        // Datos no sensibles que el cliente necesita para recuperarse (p. ej. la revisión vigente).
        if (typeof obj.details === "object" && obj.details !== null && !Array.isArray(obj.details)) details = obj.details as Record<string, number | string>;
      } else {
        code = `HTTP_${statusCode}`;
        message = DEFAULT_MESSAGES[statusCode] ?? "Error en la solicitud.";
      }
    } else if (typeof exception === "object" && exception !== null) {
      // Errores de body-parser (Express): cuerpo demasiado grande o JSON mal formado.
      const e = exception as { type?: unknown; status?: unknown };
      if (e.type === "entity.too.large") {
        statusCode = 413;
        code = "PAYLOAD_TOO_LARGE";
        message = DEFAULT_MESSAGES[413]!;
      } else if (e.type === "entity.parse.failed" || e.type === "encoding.unsupported") {
        statusCode = 400;
        code = "INVALID_BODY";
        message = "El cuerpo de la solicitud no es válido.";
      }
    }

    if (statusCode >= 500) {
      this.logger.error(`${requestId} ${req.method} ${req.originalUrl.split("?")[0]} -> ${describeError(exception)}`);
    }

    if (retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(retryAfterSeconds));
    const body: ApiErrorBody = {
      statusCode,
      code,
      message,
      requestId,
      ...(errors ? { errors } : {}),
      ...(details ? { details } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
    res.status(statusCode).json(body);
  }
}
