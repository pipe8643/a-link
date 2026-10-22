import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, IsUUID } from "class-validator";
import { NameField, trim } from "../common/dto-helpers.js";

const FOLDER_OR_ROOT = /^(root|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const FILE_FORMATS = ["png", "jpeg", "pdf", "pptx"] as const;

/** PATCH de un archivo: ausente = sin cambios; `folderId: null` = mover a la raíz. */
export class UpdateFileDto {
  @IsOptional()
  @NameField()
  name?: string;

  @ValidateIf((o: UpdateFileDto) => o.folderId !== undefined && o.folderId !== null)
  @IsUUID("4")
  folderId?: string | null;
}

/** Subida: `folderId` opcional (UUID de carpeta propia o `root`); sin él, la carpeta del grafo. */
export class UploadExportQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(FOLDER_OR_ROOT, { message: "debe ser 'root' o un UUID v4" })
  folderId?: string;
}

export class ListFilesQuery {
  @IsOptional()
  @IsUUID("4")
  graphId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(FOLDER_OR_ROOT, { message: "debe ser 'root' o un UUID v4" })
  folderId?: string;

  @IsOptional()
  @IsIn(FILE_FORMATS)
  format?: (typeof FILE_FORMATS)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

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
