import { BadRequestException, ConflictException, HttpException, Injectable } from "@nestjs/common";
import { GRAPH_LIMITS, IMAGE_LIMITS } from "@a-link/shared";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { OwnershipService, notFound } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { InvalidImageError, inspectImage } from "./image-inspect.js";

/** Lo que ve el cliente de una imagen. NUNCA incluye `ownerId` ni el contenido. */
const META_SELECT = { id: true, mime: true, width: true, height: true, size: true, createdAt: true } as const;

/** Una imagen sin usar se conserva este tiempo (para poder deshacer y para el intervalo entre subir y guardar). */
export const UNUSED_IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;

function fail(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

/**
 * Imágenes de entidades.
 *
 * Seguridad:
 *  - Todas las consultas filtran por `ownerId` (de la sesión) Y por `graphId`; ajeno o inexistente → mismo 404.
 *  - El formato se decide por la FIRMA binaria (no por `Content-Type`); se leen las dimensiones del encabezado y se
 *    rechazan metadatos incrustados (EXIF/GPS, XMP, texto): ver `image-inspect.ts`.
 *  - Límites: tamaño por imagen, imágenes por grafo y espacio total por cuenta (comprobados DENTRO del bloqueo del
 *    usuario, para que dos subidas simultáneas no se salten el límite).
 *  - Una imagen repetida en el mismo grafo (mismo SHA-256) no se vuelve a guardar.
 */
@Injectable()
export class ImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditService,
  ) {}

  async create(ownerId: string, graphId: string, input: { data: unknown; declaredMime: string | undefined }) {
    const graph = await this.ownership.graph(ownerId, graphId);
    if (graph.deletedAt) throw fail(409, "GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para añadir imágenes.");

    const data = input.data;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new BadRequestException({ code: "EMPTY_FILE", message: "No se recibió ninguna imagen." });
    if (data.length > IMAGE_LIMITS.maxBytes) {
      throw fail(413, "PAYLOAD_TOO_LARGE", `La imagen supera el máximo de ${Math.floor(IMAGE_LIMITS.maxBytes / 1024)} KB. Reduce el recorte.`);
    }

    let info;
    try {
      info = inspectImage(data);
    } catch (err) {
      if (err instanceof InvalidImageError) throw fail(415, err.reason === "metadata" ? "IMAGE_HAS_METADATA" : "UNSUPPORTED_IMAGE", err.message);
      throw err;
    }
    const declared = (input.declaredMime ?? "").split(";")[0]!.trim().toLowerCase();
    if (declared !== info.mime) throw fail(415, "MIME_MISMATCH", "El tipo de contenido declarado no coincide con el contenido real de la imagen.");

    const sha256 = createHash("sha256").update(data).digest("hex");

    const row = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const current = await this.ownership.graph(ownerId, graphId, tx);
      if (current.deletedAt) throw fail(409, "GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para añadir imágenes.");

      const same = await tx.graphImage.findFirst({ where: { graphId, ownerId, sha256 }, select: META_SELECT });
      if (same) return same;

      const totals = await tx.graphImage.aggregate({ where: { ownerId }, _sum: { size: true } });
      const inGraph = await tx.graphImage.count({ where: { graphId, ownerId } });
      if (inGraph >= GRAPH_LIMITS.maxImagesPerGraph) {
        throw new ConflictException({ code: "IMAGE_LIMIT_REACHED", message: `Este grafo ya tiene ${GRAPH_LIMITS.maxImagesPerGraph} imágenes.` });
      }
      if ((totals._sum.size ?? 0) + data.length > IMAGE_LIMITS.maxBytesPerUser) {
        throw new ConflictException({ code: "IMAGE_QUOTA_EXCEEDED", message: "No queda espacio para más imágenes en tu cuenta." });
      }
      return tx.graphImage.create({
        data: { ownerId, graphId, mime: info.mime, width: info.width, height: info.height, size: data.length, sha256, data: new Uint8Array(data) },
        select: META_SELECT,
      });
    });
    await this.audit.record({ actorId: ownerId, action: "image.uploaded", resourceType: "image", resourceId: row.id, metadata: { bytes: data.length } });
    return row;
  }

  /** Contenido para el PROPIETARIO. Ajeno, de otro grafo o inexistente → mismo 404. */
  async open(ownerId: string, graphId: string, imageId: string) {
    const row = await this.prisma.client.graphImage.findFirst({
      where: { id: imageId, graphId, ownerId },
      select: { mime: true, sha256: true, data: true },
    });
    if (!row) throw notFound();
    return { mime: row.mime, etag: `"${row.sha256}"`, data: Buffer.from(row.data) };
  }
}
