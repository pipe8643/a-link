import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentAuth } from "../auth/auth.guard.js";
import { uuidParam } from "../common/dto-helpers.js";
import { OwnershipService } from "../common/ownership.service.js";
import type { AuthContext } from "../common/request-context.js";
import { ListFilesQuery, UpdateFileDto, UploadExportQuery } from "./dto.js";
import { ExportsService } from "./exports.service.js";

/** Cabecera con el nombre del archivo (codificado con `encodeURIComponent`): así el nombre no viaja en la URL ni en los registros de acceso. */
export const EXPORT_NAME_HEADER = "x-export-name";

function decodeName(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string" || header === "") return undefined;
  if (header.length > 900) throw new BadRequestException({ code: "INVALID_NAME", message: "El nombre del archivo es demasiado largo." });
  try {
    return decodeURIComponent(header);
  } catch {
    throw new BadRequestException({ code: "INVALID_NAME", message: "El nombre del archivo no es válido." });
  }
}

/** Subida y listado de las exportaciones de UN grafo. El cuerpo es el fichero en binario (no JSON). */
@ApiTags("exports")
@Controller("graphs/:graphId/exports")
export class GraphExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly ownership: OwnershipService,
  ) {}

  /**
   * Guarda una copia privada del fichero ya generado en el navegador. El `Content-Type` debe coincidir con el
   * contenido REAL (se comprueba la firma binaria); el nombre va en `X-Export-Name`.
   */
  @Post()
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param("graphId", uuidParam()) graphId: string,
    @Query() query: UploadExportQuery,
    @Req() req: Request,
  ) {
    const folderId = query.folderId === undefined ? undefined : query.folderId === "root" ? null : query.folderId;
    const file = await this.exports.create(auth.userId, graphId, {
      data: req.body,
      declaredMime: req.headers["content-type"],
      name: decodeName(req.headers[EXPORT_NAME_HEADER]),
      folderId,
    });
    return { file };
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Param("graphId", uuidParam()) graphId: string, @Query() query: ListFilesQuery) {
    await this.ownership.graph(auth.userId, graphId); // grafo ajeno o inexistente → 404, no una lista vacía
    return this.exports.list(auth.userId, { ...query, graphId });
  }
}

/** Metadatos, renombrado, borrado y descarga autorizada de los archivos guardados. */
@ApiTags("files")
@Controller("files")
export class FilesController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListFilesQuery) {
    return this.exports.list(auth.userId, query);
  }

  @Get(":id")
  async get(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string) {
    return { file: await this.exports.get(auth.userId, id) };
  }

  @Patch(":id")
  async update(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Body() dto: UpdateFileDto) {
    return { file: await this.exports.update(auth.userId, id, dto) };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string): Promise<void> {
    await this.exports.remove(auth.userId, id);
  }

  /** Siempre como descarga (`attachment`), con el tipo que corresponde al contenido guardado y sin que el navegador lo «adivine». */
  @Get(":id/content")
  async content(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.exports.open(auth.userId, id);
    const ascii = file.fileName.replace(/[^A-Za-z0-9._ -]+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    return new StreamableFile(file.stream, { type: file.mime, length: file.size });
  }
}
