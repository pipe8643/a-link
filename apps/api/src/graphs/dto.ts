import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { NameField, trim } from "../common/dto-helpers.js";
import { DESCRIPTION_MAX } from "../common/limits.js";

const NO_CONTROL_EXCEPT_NEWLINE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

export class CreateGraphDto {
  @NameField()
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  @Matches(NO_CONTROL_EXCEPT_NEWLINE, { message: "contiene caracteres de control no permitidos" })
  description?: string;

  @ValidateIf((o: CreateGraphDto) => o.folderId !== undefined && o.folderId !== null)
  @IsUUID("4")
  folderId?: string | null;
}

/** En PATCH: ausente = sin cambios; `folderId: null` = mover a la raíz. */
export class UpdateGraphDto {
  @IsOptional()
  @NameField()
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  @Matches(NO_CONTROL_EXCEPT_NEWLINE, { message: "contiene caracteres de control no permitidos" })
  description?: string;

  @ValidateIf((o: UpdateGraphDto) => o.folderId !== undefined && o.folderId !== null)
  @IsUUID("4")
  folderId?: string | null;
}

/** Sin `name`, la copia se llama "<original> (copia)". Sin `folderId`, queda en la carpeta del original. */
export class DuplicateGraphDto {
  @IsOptional()
  @NameField()
  name?: string;

  @ValidateIf((o: DuplicateGraphDto) => o.folderId !== undefined && o.folderId !== null)
  @IsUUID("4")
  folderId?: string | null;
}

export const GRAPH_SORT_FIELDS = ["updatedAt", "createdAt", "name", "deletedAt"] as const;
export type GraphSortField = (typeof GRAPH_SORT_FIELDS)[number];

const toBoolean = ({ value }: { value: unknown }) => (value === "true" ? true : value === "false" ? false : value);

export class ListGraphsQuery {
  /** UUID de carpeta, o `root` para los grafos sin carpeta. Ausente = todos. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(root|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i, {
    message: "debe ser 'root' o un UUID v4",
  })
  folderId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trashed?: boolean;

  @IsOptional()
  @IsIn(GRAPH_SORT_FIELDS)
  sort?: GraphSortField;

  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
