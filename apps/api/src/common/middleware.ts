import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import "./request-context.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Asigna un ID de correlación. Se ignora cualquier valor entrante: nunca se confía en el cliente. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

/** Las respuestas de la API contienen datos privados: ningún intermediario debe cachearlas. */
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Protección CSRF para peticiones que modifican estado: el `Origin` (o, en su defecto, el `Referer`)
 * debe pertenecer a la lista de orígenes permitidos. Se suma a la cookie SameSite=Lax.
 * Si no hay ninguno de los dos, se rechaza (los navegadores siempre envían Origin en POST/PATCH/DELETE).
 */
export function originCheckMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (origin && allowed.has(origin)) return next();
    res.status(403).json({
      statusCode: 403,
      code: "CSRF_ORIGIN",
      message: "Origen de la solicitud no permitido.",
      requestId: req.requestId,
    });
  };
}

/** Registro de acceso mínimo: SIN query string, cabeceras, cookies ni cuerpo (podrían contener secretos o datos personales). */
export function accessLogMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
      const path = req.originalUrl.split("?")[0];
      logger.log(`${req.requestId} ${req.method} ${path} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
