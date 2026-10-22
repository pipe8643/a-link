import { Controller, Get, Param, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentAuth } from "../auth/auth.guard.js";
import { uuidParam } from "../common/dto-helpers.js";
import type { AuthContext } from "../common/request-context.js";
import { ImagesService } from "./images.service.js";

/** Cabeceras de una imagen servida: tipo real, sin adivinación, sin permiso para incrustarse en otros sitios. */
export function setImageHeaders(res: Response, image: { mime: string; etag: string }): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // Privada, pero revalidable: el navegador pregunta con el ETag y la API vuelve a AUTORIZAR antes de responder 304.
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("ETag", image.etag);
}

export function sendImage(req: Request, res: Response, image: { mime: string; etag: string; data: Buffer }): StreamableFile | undefined {
  setImageHeaders(res, image);
  if (req.headers["if-none-match"] === image.etag) {
    res.status(304); // sin cuerpo: Nest cierra la respuesta
    return undefined;
  }
  return new StreamableFile(image.data, { type: image.mime, length: image.data.length });
}

/** Imágenes de las entidades de UN grafo. El cuerpo de la subida es la imagen ya recortada, en binario (no JSON). */
@ApiTags("images")
@Controller("graphs/:graphId/images")
export class GraphImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post()
  async upload(@CurrentAuth() auth: AuthContext, @Param("graphId", uuidParam()) graphId: string, @Req() req: Request) {
    const image = await this.images.create(auth.userId, graphId, { data: req.body, declaredMime: req.headers["content-type"] });
    return { image };
  }

  @Get(":imageId")
  async content(
    @CurrentAuth() auth: AuthContext,
    @Param("graphId", uuidParam()) graphId: string,
    @Param("imageId", uuidParam()) imageId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendImage(req, res, await this.images.open(auth.userId, graphId, imageId));
  }
}
