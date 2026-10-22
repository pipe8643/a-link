import { ConflictException, Injectable } from "@nestjs/common";
import { IMAGE_LIMITS } from "@a-link/shared";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { MAX_GRAPHS_PER_USER, NAME_MAX } from "../common/limits.js";
import { type Db, OwnershipService, notFound } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { StorageService } from "../storage/storage.service.js";
import type { GraphSortField } from "./dto.js";

const GRAPH_SELECT = {
  id: true,
  folderId: true,
  name: true,
  description: true,
  revision: true,
  graphDataVersion: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { nodes: true, edges: true } },
} satisfies Prisma.GraphSelect;

type GraphRow = Prisma.GraphGetPayload<{ select: typeof GRAPH_SELECT }>;

function present({ _count, ...graph }: GraphRow) {
  return { ...graph, nodeCount: _count.nodes, edgeCount: _count.edges };
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

const COPY_CHUNK = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ListInput {
  folderId?: string;
  search?: string;
  trashed?: boolean;
  sort?: GraphSortField;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

@Injectable()
export class GraphsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(ownerId: string, q: ListInput) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 24;
    const trashed = q.trashed ?? false;
    const where: Prisma.GraphWhereInput = {
      ownerId,
      deletedAt: trashed ? { not: null } : null,
      ...(q.folderId === undefined ? {} : { folderId: q.folderId === "root" ? null : q.folderId }),
      ...(q.search ? { OR: [{ name: { contains: q.search } }, { description: { contains: q.search } }] } : {}),
    };
    const sort = q.sort ?? (trashed ? "deletedAt" : "updatedAt");
    const order = q.order ?? (sort === "name" ? "asc" : "desc");

    const [total, rows] = await Promise.all([
      this.prisma.client.graph.count({ where }),
      this.prisma.client.graph.findMany({
        where,
        // `id` como desempate: la paginación es estable aunque haya valores repetidos.
        orderBy: [{ [sort]: order }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: GRAPH_SELECT,
      }),
    ]);
    return { items: rows.map(present), page, pageSize, total };
  }

  /** Devuelve el grafo aunque esté en la papelera (la propia respuesta incluye `deletedAt`). */
  async get(ownerId: string, id: string) {
    const row = await this.prisma.client.graph.findFirst({ where: { id, ownerId }, select: GRAPH_SELECT });
    if (!row) throw notFound();
    return present(row);
  }

  private async assertUnderLimit(ownerId: string, tx: Db): Promise<void> {
    const total = await tx.graph.count({ where: { ownerId } });
    if (total >= MAX_GRAPHS_PER_USER) {
      throw conflict("GRAPH_LIMIT_REACHED", `Se alcanzó el máximo de ${MAX_GRAPHS_PER_USER} grafos (incluida la papelera).`);
    }
  }

  async create(ownerId: string, input: { name: string; description?: string; folderId?: string | null }) {
    const graph = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      await this.assertUnderLimit(ownerId, tx);
      const folder = await this.ownership.optionalFolder(ownerId, input.folderId, tx);
      return tx.graph.create({
        data: { ownerId, name: input.name, description: input.description ?? "", folderId: folder?.id ?? null },
        select: GRAPH_SELECT,
      });
    });
    await this.audit.record({ actorId: ownerId, action: "graph.created", resourceType: "graph", resourceId: graph.id });
    return present(graph);
  }

  async update(ownerId: string, id: string, input: { name?: string; description?: string; folderId?: string | null }) {
    const graph = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const current = await this.ownership.graph(ownerId, id, tx);
      if (current.deletedAt) throw conflict("GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para editarlo.");

      const data: Prisma.GraphUncheckedUpdateManyInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.folderId !== undefined) {
        const folder = await this.ownership.optionalFolder(ownerId, input.folderId, tx);
        data.folderId = folder?.id ?? null;
      }
      if (Object.keys(data).length > 0) await tx.graph.updateMany({ where: { id, ownerId }, data });
      return tx.graph.findFirstOrThrow({ where: { id, ownerId }, select: GRAPH_SELECT });
    });
    await this.audit.record({
      actorId: ownerId,
      action: "graph.updated",
      resourceType: "graph",
      resourceId: id,
      metadata: { moved: input.folderId !== undefined },
    });
    return present(graph);
  }

  /** Papelera (borrado lógico). Ajeno, inexistente o ya en la papelera → mismo 404. */
  async trash(ownerId: string, id: string): Promise<void> {
    const res = await this.prisma.client.graph.updateMany({
      where: { id, ownerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count !== 1) throw notFound();
    await this.audit.record({ actorId: ownerId, action: "graph.trashed", resourceType: "graph", resourceId: id });
  }

  async restore(ownerId: string, id: string) {
    const res = await this.prisma.client.graph.updateMany({
      where: { id, ownerId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (res.count !== 1) throw notFound();
    await this.audit.record({ actorId: ownerId, action: "graph.restored", resourceType: "graph", resourceId: id });
    return this.get(ownerId, id);
  }

  /**
   * Borrado definitivo: solo desde la papelera. Nodos y aristas se eliminan en cascada por la BD.
   * Las exportaciones guardadas del grafo se purgan también: primero se borran sus objetos del almacenamiento privado
   * y después las filas (en cascada con el grafo). Si el almacenamiento falla, no se borra nada y se puede reintentar,
   * así nunca quedan ficheros privados huérfanos sin dueño.
   */
  async deletePermanently(ownerId: string, id: string): Promise<void> {
    await this.ownership.withOwnerLock(
      ownerId,
      async (tx) => {
        const graph = await tx.graph.findFirst({ where: { id, ownerId, deletedAt: { not: null } }, select: { id: true } });
        if (!graph) throw notFound();
        const files = await tx.exportFile.findMany({ where: { ownerId, graphId: id }, select: { storageKey: true } });
        for (const file of files) await this.storage.delete(file.storageKey);
        await tx.graph.deleteMany({ where: { id, ownerId, deletedAt: { not: null } } });
      },
      60_000,
    );
    await this.audit.record({ actorId: ownerId, action: "graph.deleted", resourceType: "graph", resourceId: id });
  }

  /** Copia el grafo (nodos y aristas) con identificadores NUEVOS generados por el servidor. */
  async duplicate(ownerId: string, id: string, input: { name?: string; folderId?: string | null }) {
    const copy = await this.ownership.withOwnerLock(
      ownerId,
      async (tx) => {
        const source = await tx.graph.findFirst({ where: { id, ownerId } });
        if (!source) throw notFound();
        if (source.deletedAt) throw conflict("GRAPH_IN_TRASH", "El grafo está en la papelera. Restáuralo para duplicarlo.");
        await this.assertUnderLimit(ownerId, tx);

        const targetFolderId =
          input.folderId === undefined ? source.folderId : (await this.ownership.optionalFolder(ownerId, input.folderId, tx))?.id ?? null;
        const name = (input.name ?? `${source.name} (copia)`).slice(0, NAME_MAX);

        const created = await tx.graph.create({
          data: {
            ownerId,
            folderId: targetFolderId,
            name,
            description: source.description,
            graphDataVersion: source.graphDataVersion,
            ...(source.viewState !== null ? { viewState: source.viewState as Prisma.InputJsonValue } : {}),
          },
          select: { id: true },
        });

        // Las imágenes se copian (identificadores nuevos): cada grafo es dueño de las suyas y se borran con él.
        const sourceImages = await tx.graphImage.findMany({ where: { graphId: source.id, ownerId, nodes: { some: {} } } });
        const imageMap = new Map(sourceImages.map((i) => [i.id, randomUUID()]));
        if (sourceImages.length > 0) {
          const used = await tx.graphImage.aggregate({ where: { ownerId }, _sum: { size: true } });
          const extra = sourceImages.reduce((sum, i) => sum + i.size, 0);
          if ((used._sum.size ?? 0) + extra > IMAGE_LIMITS.maxBytesPerUser) {
            throw conflict("IMAGE_QUOTA_EXCEEDED", "No queda espacio para duplicar las imágenes de este grafo en tu cuenta.");
          }
        }
        for (const img of sourceImages) {
          await tx.graphImage.create({
            data: { id: imageMap.get(img.id)!, ownerId, graphId: created.id, mime: img.mime, width: img.width, height: img.height, size: img.size, sha256: img.sha256, data: img.data },
          });
        }

        const nodes = await tx.graphNode.findMany({ where: { graphId: source.id } });
        const idMap = new Map(nodes.map((n) => [n.id, randomUUID()]));
        for (const part of chunk(nodes, COPY_CHUNK)) {
          await tx.graphNode.createMany({
            data: part.map((n) => ({
              id: idMap.get(n.id)!,
              graphId: created.id,
              type: n.type,
              label: n.label,
              description: n.description,
              notes: n.notes,
              tags: n.tags as Prisma.InputJsonValue,
              metadata: n.metadata as Prisma.InputJsonValue,
              imageId: n.imageId ? (imageMap.get(n.imageId) ?? null) : null,
              positionX: n.positionX,
              positionY: n.positionY,
            })),
          });
        }
        const edges = await tx.graphEdge.findMany({ where: { graphId: source.id } });
        for (const part of chunk(edges, COPY_CHUNK)) {
          await tx.graphEdge.createMany({
            data: part.map((e) => ({
              id: randomUUID(),
              graphId: created.id,
              sourceNodeId: idMap.get(e.sourceNodeId)!,
              targetNodeId: idMap.get(e.targetNodeId)!,
              relationshipType: e.relationshipType,
              label: e.label,
              metadata: e.metadata as Prisma.InputJsonValue,
            })),
          });
        }
        return tx.graph.findFirstOrThrow({ where: { id: created.id, ownerId }, select: GRAPH_SELECT });
      },
      60_000,
    );
    await this.audit.record({
      actorId: ownerId,
      action: "graph.duplicated",
      resourceType: "graph",
      resourceId: copy.id,
      metadata: { nodes: copy._count.nodes, edges: copy._count.edges },
    });
    return present(copy);
  }
}
