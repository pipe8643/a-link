import { BadRequestException, ValidationPipe, type ValidationError } from "@nestjs/common";

function flatten(errors: ValidationError[], parent = ""): Array<{ field: string; rule: string }> {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.keys(e.constraints ?? {}).map((rule) => ({ field, rule }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * ValidationPipe estricto: elimina campos desconocidos y RECHAZA los no declarados (evita
 * asignación masiva, p. ej. enviar `ownerId` o `isAdmin`). La respuesta de error indica campo y regla
 * pero NUNCA el valor enviado.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        errors: flatten(errors),
      }),
  });
}
