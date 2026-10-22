import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt } from "class-validator";
import type { Request, Response } from "express";
import { CurrentAuth, Public } from "../auth/auth.guard.js";
import { uuidParam } from "../common/dto-helpers.js";
import type { AuthContext } from "../common/request-context.js";
import { sendImage } from "../images/images.controller.js";
import { SHARE_DAYS, SharesService } from "./shares.service.js";

/** Cabecera con el token de un enlace compartido (nunca en la URL: no debe quedar en registros de acceso). */
export const SHARE_TOKEN_HEADER = "x-share-token";

export class CreateShareDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([...SHARE_DAYS], { message: `debe ser uno de: ${SHARE_DAYS.join(", ")}` })
  days!: number;
}

/** Gestión de los enlaces de UN grafo (solo el propietario). */
@ApiTags("shares")
@Controller("graphs/:graphId/shares")
export class GraphSharesController {
  constructor(private readonly shares: SharesService) {}

  /** Crea un enlace de solo lectura. El token se devuelve UNA sola vez. */
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Param("graphId", uuidParam()) graphId: string, @Body() dto: CreateShareDto) {
    return this.shares.create(auth.userId, graphId, dto.days);
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Param("graphId", uuidParam()) graphId: string) {
    return this.shares.list(auth.userId, graphId);
  }

  @Delete(":shareId")
  @HttpCode(204)
  async revoke(@CurrentAuth() auth: AuthContext, @Param("graphId", uuidParam()) graphId: string, @Param("shareId", uuidParam()) shareId: string): Promise<void> {
    await this.shares.revoke(auth.userId, graphId, shareId);
  }
}

function noIndex(res: Response): void {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

/** Vista pública de solo lectura: sin sesión; se autoriza ÚNICAMENTE con el token de la cabecera `X-Share-Token`. */
@ApiTags("shared")
@Public()
@Controller("shared")
export class SharedController {
  constructor(private readonly shares: SharesService) {}

  @Get("graph")
  graph(@Headers(SHARE_TOKEN_HEADER) token: string | undefined, @Res({ passthrough: true }) res: Response) {
    noIndex(res);
    return this.shares.viewGraph(token);
  }

  @Get("images/:imageId")
  async image(
    @Headers(SHARE_TOKEN_HEADER) token: string | undefined,
    @Param("imageId", uuidParam()) imageId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    noIndex(res);
    return sendImage(req, res, await this.shares.viewImage(token, imageId));
  }
}
