import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { AuditService } from "../audit/audit.service.js";
import { MAX_EXPORTS_PER_USER } from "../common/limits.js";
import { type Db, OwnershipService, notFound } from "../common/ownership.service.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../db/prisma.service.js";
import type { ExportFormat, Prisma } from "../generated/prisma/client.js";
import { StorageNotFoundError, StorageService } from "../storage/storage.service.js";
import { FORMAT_EXTENSION, FORMAT_MIME, type StoredFormat, detectFormat, normalizeMime } from "./file-signature.js";

const FILE_SELECT = {
  id: true,
  graphId: true,
  folderId: true,
  name: true,
  format: true,
  fileSize: true,
  sha256: true,
  createdAt: true,
  updatedAt: true,
  graph: { select: { name: true, deletedAt: true } },
} satisfies Prisma.ExportFileSelect;

type FileRow = Prisma.ExportFileGetPayload<{ select: typeof FILE_SELECT }>;

/** Lo que ve el cliente. NUNCA incluye `storageKey` ni `ownerId`. */
function present({ graph, format, ...file }: FileRow) {
  return { ...file, format: format.toLowerCase() as Lowercase<ExportFormat>, graphName: graph.name, graphTrashed: graph.deletedAt !== null };
}

const NAME_LIMIT = 120;

function fail(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

/**
 * Nombre visible de la exportación, SIN extensión: sin separadores de ruta ni caracteres de control, espacios
 * normalizados y longitud acotada. Si el cliente envía «grafo.png» para un PNG, se quita la extensión repetida.
 */
export function cleanExportName(raw: string, format: StoredFormat, fallback: string): string {
  let name = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ext = `.${FORMAT_EXTENSION[format]}`;
  if (name.toLowerCase().endsWith(ext)) name = name.slice(0, -ext.length).trim();
  name = name.replace(/^\.+/, "").trim().slice(0, NAME_LIMIT).trim();
  return name || fallback.slice(0, NAME_LIMIT) || "exportacion";
}

export interface CreateExportInput {
  data: unknown;
  declaredMime: string | undefined;
  name: string | undefined;
  /** `undefined` = carpeta del grafo; `null` = raíz; texto = carpeta propia. */
  folderId: string | null | undefined;
}

export interface ListFilesInput {
  graphId?: string;
  folderId?: string;
  format?: Lowercase<ExportFormat>;
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger("Exportaciones");

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async assertQuota(ownerId: string, incomingBytes: number, db: Db): Promise<void> {
    const total = await db.exportFile.aggregate({ where: { ownerId }, _count: { _all: true }, _sum: { fileSize: true } });
    if (total._count._all >= MAX_EXPORTS_PER_USER) {
      throw new ConflictException({ code: "EXPORT_LIMIT_REACHED", message: `Se alcanzó el máximo de ${MAX_EXPORTS_PER_USER} exportaciones guardadas. Elimina alguna para guardar más.` });
    }
    if ((total._sum.fileSize ?? 0) + incomingBytes > this.config.exportQuotaBytes) {
      throw new ConflictException({ code: "EXPORT_QUOTA_EXCEEDED", message: "No queda espacio para guardar más exportaciones. Elimina alguna para liberar espacio." });
    }
  }

  async create(ownerId: string, graphId: string, input: CreateExportInput) {
    const graph = await this.ownership.graph(ownerId, graphId);
    if (graph.deletedAt) throw fail(409, "GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para guardar exportaciones.");

    const data = input.data;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new BadRequestException({ code: "EMPTY_FILE", message: "No se recibió ningún archivo." });
    if (data.length > this.config.maxExportFileBytes) {
      throw fail(413, "PAYLOAD_TOO_LARGE", `El archivo supera el máximo de ${Math.floor(this.config.maxExportFileBytes / 1024 / 1024)} MB.`);
    }

    // El contenido manda: el tipo declarado solo se usa para detectar clientes defectuosos.
    const format = detectFormat(data);
    if (!format) throw fail(415, "UNSUPPORTED_FILE", "El archivo no es una imagen PNG o JPEG, un PDF ni un PowerPoint válido.");
    const mime = FORMAT_MIME[format];
    if (normalizeMime(input.declaredMime) !== mime) {
      throw fail(415, "MIME_MISMATCH", "El tipo de contenido declarado no coincide con el contenido real del archivo.");
    }

    const name = cleanExportName(input.name ?? "", format, graph.name);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const storageKey = `exports/${ownerId}/${randomUUID()}`;

    // Comprobación previa y barata para no escribir en el almacenamiento algo que se va a rechazar.
    await this.assertQuota(ownerId, data.length, this.prisma.client);

    await this.storage.put(storageKey, data, mime);
    try {
      const row = await this.ownership.withOwnerLock(
        ownerId,
        async (tx) => {
          // Dentro del bloqueo se vuelve a comprobar todo: dos subidas simultáneas no pueden saltarse el límite.
          const current = await this.ownership.graph(ownerId, graphId, tx);
          if (current.deletedAt) throw fail(409, "GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para guardar exportaciones.");
          const folder = input.folderId === undefined ? { id: current.folderId } : await this.ownership.optionalFolder(ownerId, input.folderId, tx);
          await this.assertQuota(ownerId, data.length, tx);
          return tx.exportFile.create({
            data: { ownerId, graphId, folderId: folder?.id ?? null, name, format: format as ExportFormat, storageKey, fileSize: data.length, sha256 },
            select: FILE_SELECT,
          });
        },
        30_000,
      );
      await this.audit.record({ actorId: ownerId, action: "export.created", resourceType: "export", resourceId: row.id, metadata: { format, bytes: data.length } });
      return present(row);
    } catch (err) {
      // Nunca deben quedar ficheros privados sin fila (sin dueño) en el almacenamiento.
      await this.storage.delete(storageKey).catch(() => this.logger.error("No se pudo retirar un objeto tras un fallo al guardar la exportación."));
      throw err;
    }
  }

  async list(ownerId: string, q: ListFilesInput) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 24;
    const where: Prisma.ExportFileWhereInput = {
      ownerId,
      ...(q.graphId ? { graphId: q.graphId } : {}),
      ...(q.folderId === undefined ? {} : { folderId: q.folderId === "root" ? null : q.folderId }),
      ...(q.format ? { format: q.format.toUpperCase() as ExportFormat } : {}),
      ...(q.search ? { name: { contains: q.search } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.exportFile.count({ where }),
      this.prisma.client.exportFile.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: FILE_SELECT,
      }),
    ]);
    return { items: rows.map(present), page, pageSize, total };
  }

  async get(ownerId: string, id: string) {
    const row = await this.prisma.client.exportFile.findFirst({ where: { id, ownerId }, select: FILE_SELECT });
    if (!row) throw notFound();
    return present(row);
  }

  async update(ownerId: string, id: string, input: { name?: string; folderId?: string | null }) {
    const row = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const current = await tx.exportFile.findFirst({ where: { id, ownerId }, select: { format: true, graph: { select: { name: true } } } });
      if (!current) throw notFound();
      const data: Prisma.ExportFileUncheckedUpdateManyInput = {};
      if (input.name !== undefined) data.name = cleanExportName(input.name, current.format as StoredFormat, current.graph.name);
      if (input.folderId !== undefined) data.folderId = (await this.ownership.optionalFolder(ownerId, input.folderId, tx))?.id ?? null;
      if (Object.keys(data).length > 0) await tx.exportFile.updateMany({ where: { id, ownerId }, data });
      return tx.exportFile.findFirstOrThrow({ where: { id, ownerId }, select: FILE_SELECT });
    });
    await this.audit.record({ actorId: ownerId, action: "export.updated", resourceType: "export", resourceId: id, metadata: { renamed: input.name !== undefined, moved: input.folderId !== undefined } });
    return present(row);
  }

  /** Borra primero el objeto y después la fila: si algo falla, el usuario sigue viendo el archivo y puede reintentar. */
  async remove(ownerId: string, id: string): Promise<void> {
    const row = await this.prisma.client.exportFile.findFirst({ where: { id, ownerId }, select: { storageKey: true } });
    if (!row) throw notFound();
    await this.storage.delete(row.storageKey);
    await this.prisma.client.exportFile.deleteMany({ where: { id, ownerId } });
    await this.audit.record({ actorId: ownerId, action: "export.deleted", resourceType: "export", resourceId: id });
  }

  /** Ficheros y metadatos listos para la descarga; solo del propietario (ajeno o inexistente → mismo 404). */
  async open(ownerId: string, id: string): Promise<{ stream: Readable; size: number; mime: string; fileName: string }> {
    const row = await this.prisma.client.exportFile.findFirst({ where: { id, ownerId }, select: { storageKey: true, name: true, format: true } });
    if (!row) throw notFound();
    const format = row.format as StoredFormat;
    try {
      const { stream, size } = await this.storage.get(row.storageKey);
      await this.audit.record({ actorId: ownerId, action: "export.downloaded", resourceType: "export", resourceId: id });
      return { stream, size, mime: FORMAT_MIME[format], fileName: `${row.name}.${FORMAT_EXTENSION[format]}` };
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new NotFoundException({ code: "FILE_UNAVAILABLE", message: "El archivo ya no está disponible. Puedes eliminarlo de la lista." });
      }
      throw err;
    }
  }
}
