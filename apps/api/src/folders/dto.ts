import { IsIn, IsOptional, IsUUID, ValidateIf } from "class-validator";
import { NameField } from "../common/dto-helpers.js";

/** `parentId` ausente o null = carpeta en la raíz. El propietario NUNCA se acepta del cliente. */
export class CreateFolderDto {
  @NameField()
  name!: string;

  @ValidateIf((o: CreateFolderDto) => o.parentId !== undefined && o.parentId !== null)
  @IsUUID("4")
  parentId?: string | null;
}

/** En PATCH: ausente = sin cambios; `parentId: null` = mover a la raíz. */
export class UpdateFolderDto {
  @IsOptional()
  @NameField()
  name?: string;

  @ValidateIf((o: UpdateFolderDto) => o.parentId !== undefined && o.parentId !== null)
  @IsUUID("4")
  parentId?: string | null;
}

export const DELETE_MODES = ["move_to_parent", "trash"] as const;
export type DeleteMode = (typeof DELETE_MODES)[number];

export class DeleteFolderQuery {
  /**
   * Qué hacer con el contenido de la carpeta:
   *  - move_to_parent: subcarpetas y grafos suben al padre.
   *  - trash: los grafos activos van a la papelera y las subcarpetas se eliminan.
   * Si la carpeta no está vacía y no se indica, la API responde 409.
   */
  @IsOptional()
  @IsIn(DELETE_MODES)
  contents?: DeleteMode;
}
