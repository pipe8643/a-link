import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import { type EntityTypeId, sensitiveKeysFor } from "@a-link/shared";
import { createHash, randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { OwnershipService, notFound } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";

/** Duraciones permitidas (días). Un enlace SIEMPRE caduca. */
export const SHARE_DAYS = [1, 7, 30] as const;
export const MAX_ACTIVE_SHARES_PER_GRAPH = 10;
/** Texto libre que puede contener datos que el propietario no quiso difundir: nunca sale por un enlace. */
const SHARE_HIDDEN_METADATA_KEYS = ["observations"] as const;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export type ShareStatus = "active" | "expired" | "revoked";

function statusOf(row: { revokedAt: Date | null; expiresAt: Date }, now = new Date()): ShareStatus {
  if (row.revokedAt) return "revoked";
  return row.expiresAt <= now ? "expired" : "active";
}

const SHARE_SELECT = { id: true, createdAt: true, expiresAt: true, revokedAt: true, lastViewedAt: true, viewCount: true } as const;
const present = (row: { id: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; lastViewedAt: Date | null; viewCount: number }) => ({
  ...row,
  status: statusOf(row),
});

/**
 * Enlaces de SOLO LECTURA a un grafo.
 *
 * Seguridad:
 *  - El token (256 bits aleatorios) se devuelve UNA vez, al crearlo; en la base de datos solo está su SHA-256, así que
 *    un volcado de la base no permite abrir ningún enlace.
 *  - Crear, listar y revocar exigen sesión y propiedad del grafo (ajeno o inexistente → mismo 404). Un enlace revocado,
 *    caducado, inexistente o de un grafo en la papelera responde EXACTAMENTE igual (404 genérico).
 *  - La vista pública solo expone lo necesario para VER el grafo: nunca notas, campos sensibles del catálogo, la
 *    descripción/fuente/confianza de las relaciones ni identificadores de propietario.
 *  - El token viaja en una cabecera (no en la URL de la API), así que no queda en registros de acceso.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditService,
  ) {}

  async create(ownerId: string, graphId: string, days: number) {
    const graph = await this.ownership.graph(ownerId, graphId);
    if (graph.deletedAt) throw new HttpException({ code: "GRAPH_IN_TRASH", message: "El grafo está en la papelera. Restáuralo para compartirlo." }, 409);

    const token = randomBytes(32).toString("base64url");
    const row = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const current = await this.ownership.graph(ownerId, graphId, tx);
      if (current.deletedAt) throw new HttpException({ code: "GRAPH_IN_TRASH", message: "El grafo está en la papelera. Restáuralo para compartirlo." }, 409);
      const now = new Date();
      const active = await tx.shareLink.count({ where: { graphId, ownerId, revokedAt: null, expiresAt: { gt: now } } });
      if (active >= MAX_ACTIVE_SHARES_PER_GRAPH) {
        throw new ConflictException({ code: "SHARE_LIMIT_REACHED", message: `Este grafo ya tiene ${MAX_ACTIVE_SHARES_PER_GRAPH} enlaces activos. Revoca alguno para crear otro.` });
      }
      return tx.shareLink.create({
        data: { ownerId, graphId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + days * DAY_MS) },
        select: SHARE_SELECT,
      });
    });
    await this.audit.record({ actorId: ownerId, action: "share.created", resourceType: "share", resourceId: row.id, metadata: { days } });
    return { share: present(row), token };
  }

  async list(ownerId: string, graphId: string) {
    await this.ownership.graph(ownerId, graphId);
    const rows = await this.prisma.client.shareLink.findMany({
      where: { graphId, ownerId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 50,
      select: SHARE_SELECT,
    });
    return { items: rows.map(present) };
  }

  /** Idempotente: revocar un enlace ya revocado responde igual. */
  async revoke(ownerId: string, graphId: string, shareId: string): Promise<void> {
    const row = await this.prisma.client.shareLink.findFirst({ where: { id: shareId, graphId, ownerId }, select: { id: true, revokedAt: true } });
    if (!row) throw notFound();
    if (!row.revokedAt) {
      await this.prisma.client.shareLink.updateMany({ where: { id: shareId, graphId, ownerId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: ownerId, action: "share.revoked", resourceType: "share", resourceId: shareId });
    }
  }

  // --- Vista pública (sin sesión) -------------------------------------------------------------------

  /** Resuelve un token a su enlace VIGENTE. Cualquier fallo → el mismo 404. */
  private async resolve(token: string | undefined) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw notFound();
    const row = await this.prisma.client.shareLink.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() }, graph: { deletedAt: null } },
      select: { id: true, ownerId: true, graphId: true, expiresAt: true, graph: { select: { name: true } } },
    });
    if (!row) throw notFound();
    return row;
  }

  async viewGraph(token: string | undefined) {
    const link = await this.resolve(token);
    const [nodes, edges] = await Promise.all([
      this.prisma.client.graphNode.findMany({
        where: { graphId: link.graphId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, type: true, label: true, tags: true, metadata: true, imageId: true, positionX: true, positionY: true },
      }),
      this.prisma.client.graphEdge.findMany({
        where: { graphId: link.graphId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, sourceNodeId: true, targetNodeId: true, relationshipType: true, label: true, metadata: true },
      }),
    ]);
    // Contador de visitas: solo informativo para el propietario; un fallo aquí no debe impedir ver el grafo.
    await this.prisma.client.shareLink
      .update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } })
      .catch(() => undefined);

    return {
      name: link.graph.name,
      expiresAt: link.expiresAt,
      nodes: nodes.map((n) => {
        const hidden = new Set([...sensitiveKeysFor(n.type as EntityTypeId), ...SHARE_HIDDEN_METADATA_KEYS]);
        const metadata = Object.fromEntries(Object.entries(n.metadata as Record<string, string>).filter(([key]) => !hidden.has(key)));
        return { id: n.id, type: n.type, label: n.label, tags: n.tags as string[], metadata, imageId: n.imageId, positionX: n.positionX, positionY: n.positionY };
      }),
      edges: edges.map((e) => {
        const m = e.metadata as { direction?: string; evidenceClass?: string; startDate?: string; endDate?: string };
        return {
          id: e.id,
          sourceId: e.sourceNodeId,
          targetId: e.targetNodeId,
          relationshipType: e.relationshipType,
          label: e.label,
          metadata: { direction: m.direction ?? "forward", evidenceClass: m.evidenceClass ?? "hypothesis", ...(m.startDate ? { startDate: m.startDate } : {}), ...(m.endDate ? { endDate: m.endDate } : {}) },
        };
      }),
    };
  }

  /** Solo imágenes de ESTE grafo que SIGUEN en uso por alguna entidad (una imagen retirada no se filtra por el enlace). */
  async viewImage(token: string | undefined, imageId: string) {
    const link = await this.resolve(token);
    const row = await this.prisma.client.graphImage.findFirst({
      where: { id: imageId, graphId: link.graphId, nodes: { some: {} } },
      select: { mime: true, sha256: true, data: true },
    });
    if (!row) throw notFound();
    return { mime: row.mime, etag: `"${row.sha256}"`, data: Buffer.from(row.data) };
  }

  /** Membrete del PROPIETARIO del grafo compartido. Si no tiene uno personal, 404 (el visor queda en blanco). */
  async viewLetterhead(token: string | undefined) {
    const link = await this.resolve(token);
    const row = await this.prisma.client.userLetterhead.findUnique({
      where: { userId: link.ownerId },
      select: { mime: true, sha256: true, data: true },
    });
    if (!row) throw notFound();
    return { mime: row.mime, etag: `"${row.sha256}"`, data: Buffer.from(row.data) };
  }
}
