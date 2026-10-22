import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { type GraphContentSave, type GraphEdgeData, type GraphNodeData, parseGraphContentSave } from "@a-link/shared";
import { UNUSED_IMAGE_GRACE_MS } from "../images/images.service.js";
import { notFound } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

const CHUNK = 1000;
const TX_TIMEOUT_MS = 60_000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** JSON canónico (claves ordenadas): MySQL reordena las claves de las columnas JSON, así que no se puede comparar el texto tal cual. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const nodeFingerprint = (n: Pick<GraphNodeData, "type" | "label" | "description" | "notes" | "tags" | "metadata" | "imageId" | "positionX" | "positionY">) =>
  canon([n.type, n.label, n.description, n.notes, n.tags, n.metadata, n.imageId ?? null, n.positionX, n.positionY]);

const edgeFingerprint = (e: { sourceNodeId: string; targetNodeId: string; relationshipType: string; label: string; metadata: unknown }) =>
  canon([e.sourceNodeId, e.targetNodeId, e.relationshipType, e.label, e.metadata]);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Contenido de un grafo (entidades y relaciones).
 *
 * Seguridad:
 *  - El grafo se resuelve SIEMPRE con `ownerId` de la sesión; ajeno o inexistente → mismo 404.
 *  - El cuerpo se valida con el MISMO esquema que usa el editor (`@a-link/shared`); el servidor no confía en el cliente.
 *  - Nodos y aristas no tienen propietario propio: heredan el del grafo, y las claves foráneas compuestas de la
 *    BD impiden que una arista una nodos de grafos distintos.
 *  - Un identificador que ya pertenece a OTRO grafo se rechaza con un error genérico (no se revela de quién es).
 *
 * Concurrencia optimista: `expectedRevision` debe coincidir con la revisión vigente. La comprobación y el
 * incremento son una sola sentencia `UPDATE … WHERE revision = ?` que además bloquea la fila hasta el final de
 * la transacción: dos guardados simultáneos no pueden pisarse; el segundo recibe 409 con la revisión vigente.
 */
@Injectable()
export class GraphContentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(ownerId: string, graphId: string) {
    const graph = await this.prisma.client.graph.findFirst({
      where: { id: graphId, ownerId },
      select: { id: true, revision: true, graphDataVersion: true, deletedAt: true },
    });
    if (!graph) throw notFound();
    if (graph.deletedAt) throw new ConflictException({ code: "GRAPH_IN_TRASH", message: "El grafo está en la papelera. Restáuralo para editarlo." });

    // Lectura coherente: revisión, nodos y aristas en una misma instantánea.
    const { nodes, edges, revision } = await this.prisma.client.$transaction(
      async (tx) => {
        const current = await tx.graph.findFirstOrThrow({ where: { id: graphId, ownerId }, select: { revision: true } });
        const [nodes, edges] = await Promise.all([
          tx.graphNode.findMany({ where: { graphId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          tx.graphEdge.findMany({ where: { graphId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        ]);
        return { nodes, edges, revision: current.revision };
      },
      { isolationLevel: "RepeatableRead", timeout: TX_TIMEOUT_MS },
    );

    return {
      revision,
      graphDataVersion: graph.graphDataVersion,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description,
        notes: n.notes,
        tags: n.tags as string[],
        metadata: n.metadata as Record<string, string>,
        imageId: n.imageId,
        positionX: n.positionX,
        positionY: n.positionY,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceId: e.sourceNodeId,
        targetId: e.targetNodeId,
        relationshipType: e.relationshipType,
        label: e.label,
        metadata: e.metadata as Record<string, unknown>,
      })),
    };
  }

  /** Reemplaza el contenido por el recibido aplicando solo las diferencias. Devuelve la nueva revisión. */
  async save(ownerId: string, graphId: string, raw: unknown) {
    const parsed = parseGraphContentSave(raw);
    if (!parsed.ok) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "El contenido del grafo no es válido.", errors: parsed.errors });
    }
    const input = parsed.value;

    try {
      return await this.prisma.client.$transaction((tx) => this.apply(tx, ownerId, graphId, input), {
        timeout: TX_TIMEOUT_MS,
        maxWait: 10_000,
      });
    } catch (err) {
      // Dos grafos de la misma cuenta guardados a la vez con un mismo id nuevo: la BD lo impide.
      if (isUniqueViolation(err)) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "El contenido del grafo no es válido.", errors: [{ field: "id", rule: "Identificador no disponible." }] });
      }
      throw err;
    }
  }

  private async apply(tx: Prisma.TransactionClient, ownerId: string, graphId: string, input: GraphContentSave) {
    // 1) Revisión + propiedad + no papelera, en UNA sentencia. Bloquea la fila hasta el commit.
    const claimed = await tx.graph.updateMany({
      where: { id: graphId, ownerId, deletedAt: null, revision: input.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      const graph = await tx.graph.findFirst({ where: { id: graphId, ownerId }, select: { revision: true, deletedAt: true } });
      if (!graph) throw notFound();
      if (graph.deletedAt) throw new ConflictException({ code: "GRAPH_IN_TRASH", message: "El grafo está en la papelera. Restáuralo para editarlo." });
      throw new ConflictException({
        code: "REVISION_CONFLICT",
        message: "El grafo se modificó desde otra ventana o dispositivo. Tus cambios no se han guardado.",
        details: { currentRevision: graph.revision },
      });
    }

    // 2) Estado actual para calcular diferencias.
    const [curNodes, curEdges] = await Promise.all([
      tx.graphNode.findMany({ where: { graphId } }),
      tx.graphEdge.findMany({ where: { graphId } }),
    ]);
    const curNodeById = new Map(curNodes.map((n) => [n.id, n]));
    const curEdgeById = new Map(curEdges.map((e) => [e.id, e]));

    const newNodes = input.nodes.filter((n) => !curNodeById.has(n.id));
    const newEdges = input.edges.filter((e) => !curEdgeById.has(e.id));

    // 3) Un id nuevo no puede existir ya en otro grafo (de esta u otra cuenta). Respuesta genérica.
    await this.assertIdsFree(tx, "node", newNodes.map((n) => n.id));
    await this.assertIdsFree(tx, "edge", newEdges.map((e) => e.id));
    // 3b) Las imágenes referenciadas deben ser de ESTE grafo y de esta cuenta (si no, se podría referenciar la imagen de otro).
    await this.assertImagesOwned(tx, ownerId, graphId, input.nodes);

    // 4) Borrados (las aristas primero; además la BD borra en cascada las de un nodo eliminado).
    const keepNodeIds = new Set(input.nodes.map((n) => n.id));
    const keepEdgeIds = new Set(input.edges.map((e) => e.id));
    const delEdges = curEdges.filter((e) => !keepEdgeIds.has(e.id)).map((e) => e.id);
    const delNodes = curNodes.filter((n) => !keepNodeIds.has(n.id)).map((n) => n.id);
    for (const part of chunk(delEdges, CHUNK)) await tx.graphEdge.deleteMany({ where: { graphId, id: { in: part } } });
    for (const part of chunk(delNodes, CHUNK)) await tx.graphNode.deleteMany({ where: { graphId, id: { in: part } } });

    // 5) Altas y modificaciones. Primero los nodos (las aristas los referencian).
    for (const part of chunk(newNodes, CHUNK)) {
      await tx.graphNode.createMany({
        data: part.map((n) => ({
          id: n.id,
          graphId,
          type: n.type,
          label: n.label,
          description: n.description,
          notes: n.notes,
          tags: n.tags as Prisma.InputJsonValue,
          metadata: n.metadata as Prisma.InputJsonValue,
          imageId: n.imageId,
          positionX: n.positionX,
          positionY: n.positionY,
        })),
      });
    }
    let nodesChanged = 0;
    for (const n of input.nodes) {
      const cur = curNodeById.get(n.id);
      if (!cur || nodeFingerprint(cur as unknown as GraphNodeData) === nodeFingerprint(n)) continue;
      nodesChanged++;
      await tx.graphNode.updateMany({
        where: { id: n.id, graphId },
        data: {
          type: n.type,
          label: n.label,
          description: n.description,
          notes: n.notes,
          tags: n.tags as Prisma.InputJsonValue,
          metadata: n.metadata as Prisma.InputJsonValue,
          imageId: n.imageId,
          positionX: n.positionX,
          positionY: n.positionY,
        },
      });
    }

    const toRow = (e: GraphEdgeData) => ({
      sourceNodeId: e.sourceId,
      targetNodeId: e.targetId,
      relationshipType: e.relationshipType,
      label: e.label,
      metadata: e.metadata as Prisma.InputJsonValue,
    });
    for (const part of chunk(newEdges, CHUNK)) {
      await tx.graphEdge.createMany({ data: part.map((e) => ({ id: e.id, graphId, ...toRow(e) })) });
    }
    let edgesChanged = 0;
    for (const e of input.edges) {
      const cur = curEdgeById.get(e.id);
      if (!cur || edgeFingerprint(cur) === edgeFingerprint(toRow(e))) continue;
      edgesChanged++;
      await tx.graphEdge.updateMany({ where: { id: e.id, graphId }, data: toRow(e) });
    }

    // 6) Imágenes sin uso y con más de 24 h se retiran (el margen permite deshacer y el intervalo entre subir y guardar).
    await tx.graphImage.deleteMany({
      where: { graphId, ownerId, createdAt: { lt: new Date(Date.now() - UNUSED_IMAGE_GRACE_MS) }, nodes: { none: {} } },
    });

    return {
      revision: input.expectedRevision + 1,
      nodeCount: input.nodes.length,
      edgeCount: input.edges.length,
      changes: {
        nodesAdded: newNodes.length,
        nodesChanged,
        nodesRemoved: delNodes.length,
        edgesAdded: newEdges.length,
        edgesChanged,
        edgesRemoved: delEdges.length,
      },
    };
  }

  private async assertImagesOwned(tx: Prisma.TransactionClient, ownerId: string, graphId: string, nodes: GraphNodeData[]): Promise<void> {
    const wanted = [...new Set(nodes.map((n) => n.imageId).filter((id): id is string => !!id))];
    if (wanted.length === 0) return;
    const found = new Set<string>();
    for (const part of chunk(wanted, CHUNK)) {
      const rows = await tx.graphImage.findMany({ where: { id: { in: part }, graphId, ownerId }, select: { id: true } });
      for (const r of rows) found.add(r.id);
    }
    if (found.size !== wanted.length) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "El contenido del grafo no es válido.",
        errors: [{ field: "nodes.imageId", rule: "Imagen no disponible." }],
      });
    }
  }

  private async assertIdsFree(tx: Prisma.TransactionClient, kind: "node" | "edge", ids: string[]): Promise<void> {
    for (const part of chunk(ids, CHUNK)) {
      const taken =
        kind === "node"
          ? await tx.graphNode.count({ where: { id: { in: part } } })
          : await tx.graphEdge.count({ where: { id: { in: part } } });
      if (taken > 0) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "El contenido del grafo no es válido.",
          errors: [{ field: kind === "node" ? "nodes.id" : "edges.id", rule: "Identificador no disponible." }],
        });
      }
    }
  }
}
