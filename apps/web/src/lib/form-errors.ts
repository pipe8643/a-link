import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { type ApiError, isApiError } from "./api";

const RULE_MESSAGES: Record<string, string> = {
  isEmail: "Introduce un correo válido",
  isString: "Valor no válido",
  minLength: "Es demasiado corto",
  maxLength: "Es demasiado largo",
  matches: "Contiene caracteres no permitidos",
  isUuid: "Valor no válido",
  whitelistValidation: "Campo no permitido",
};

/**
 * Traduce los errores de validación del servidor (campo + regla, nunca el valor) a errores de campo.
 * Devuelve el mensaje general que debe mostrarse si algún error no se pudo asociar a un campo.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: ReadonlyArray<FieldPath<T>>,
): string | null {
  if (!isApiError(error)) return "Ha ocurrido un error inesperado. Inténtalo de nuevo.";
  let unmatched = error.fieldErrors.length === 0;
  for (const issue of error.fieldErrors) {
    const field = knownFields.find((f) => f === issue.field);
    if (field) setError(field, { type: "server", message: RULE_MESSAGES[issue.rule] ?? "Valor no válido" });
    else unmatched = true;
  }
  return unmatched ? describeError(error) : null;
}

/** Mensaje claro para el usuario; añade el tiempo de espera cuando el servidor limita las peticiones. */
export function describeError(error: unknown): string {
  if (!isApiError(error)) return "Ha ocurrido un error inesperado. Inténtalo de nuevo.";
  return withRetry(error);
}

function withRetry(error: ApiError): string {
  if (error.status === 429 && error.retryAfterSeconds) {
    const s = error.retryAfterSeconds;
    const wait = s >= 120 ? `${Math.ceil(s / 60)} minutos` : s >= 60 ? "1 minuto" : `${s} segundos`;
    return `${error.message} Espera ${wait}.`;
  }
  return error.message;
}
