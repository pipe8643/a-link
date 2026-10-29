import { BadRequestException, HttpException, Injectable } from "@nestjs/common";
import { LETTERHEAD_LIMITS } from "@a-link/shared";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { notFound } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import { InvalidImageError, inspectImage } from "../images/image-inspect.js";

const META_SELECT = { mime: true, width: true, height: true, size: true, updatedAt: true } as const;

function fail(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

/**
 * Membrete personal: una imagen por cuenta. El visor público `/s` y el PowerPoint la usan si existe;
 * si no, el visor queda en blanco. El formato se decide por la FIRMA binaria; se rechazan EXIF/XMP.
 */
@Injectable()
export class LetterheadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upsert(ownerId: string, input: { data: unknown; declaredMime: string | undefined }) {
    const data = input.data;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new BadRequestException({ code: "EMPTY_FILE", message: "No se recibió ninguna imagen." });
    if (data.length > LETTERHEAD_LIMITS.maxBytes) {
      throw fail(413, "PAYLOAD_TOO_LARGE", `La imagen supera el máximo de ${Math.floor(LETTERHEAD_LIMITS.maxBytes / 1024)} KB.`);
    }

    let info;
    try {
      info = inspectImage(data, LETTERHEAD_LIMITS.maxSide);
    } catch (err) {
      if (err instanceof InvalidImageError) throw fail(415, err.reason === "metadata" ? "IMAGE_HAS_METADATA" : "UNSUPPORTED_IMAGE", err.message);
      throw err;
    }
    const declared = (input.declaredMime ?? "").split(";")[0]!.trim().toLowerCase();
    if (declared !== info.mime) throw fail(415, "MIME_MISMATCH", "El tipo de contenido declarado no coincide con el contenido real de la imagen.");

    const sha256 = createHash("sha256").update(data).digest("hex");
    const row = await this.prisma.client.userLetterhead.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, mime: info.mime, width: info.width, height: info.height, size: data.length, sha256, data: new Uint8Array(data) },
      update: { mime: info.mime, width: info.width, height: info.height, size: data.length, sha256, data: new Uint8Array(data) },
      select: META_SELECT,
    });
    await this.audit.record({ actorId: ownerId, action: "letterhead.updated", resourceType: "user", resourceId: ownerId, metadata: { bytes: data.length } });
    return row;
  }

  async open(ownerId: string) {
    const row = await this.prisma.client.userLetterhead.findUnique({
      where: { userId: ownerId },
      select: { mime: true, sha256: true, data: true },
    });
    if (!row) throw notFound();
    return { mime: row.mime, etag: `"${row.sha256}"`, data: Buffer.from(row.data) };
  }

  async remove(ownerId: string): Promise<void> {
    const deleted = await this.prisma.client.userLetterhead.deleteMany({ where: { userId: ownerId } });
    if (deleted.count === 0) throw notFound();
    await this.audit.record({ actorId: ownerId, action: "letterhead.deleted", resourceType: "user", resourceId: ownerId });
  }
}
