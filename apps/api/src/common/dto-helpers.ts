import { ParseUUIDPipe } from "@nestjs/common";
import { Transform } from "class-transformer";
import { MaxLength, MinLength, Matches, IsString } from "class-validator";
import { applyDecorators } from "@nestjs/common";
import { NAME_MAX } from "./limits.js";

export const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Parámetro de ruta UUID v4 (los IDs los genera el servidor con UUID v4). */
export const uuidParam = () => new ParseUUIDPipe({ version: "4" });

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

/** Nombre visible: sin espacios en los extremos, 1..NAME_MAX caracteres y sin caracteres de control. */
export function NameField() {
  return applyDecorators(
    Transform(trim),
    IsString(),
    MinLength(1),
    MaxLength(NAME_MAX),
    Matches(NO_CONTROL_CHARS, { message: "no puede contener caracteres de control" }),
  );
}
