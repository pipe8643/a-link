import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

export type Db = Prisma.TransactionClient;

/**
 * Error ÚNICO para "no existe" y "es de otro usuario": el cuerpo es idéntico, de modo que nadie puede
 * averiguar qué identificadores existen en cuentas ajenas (prevención de IDOR y de enumeración).
 */
export function notFound(): NotFoundException {
  return new NotFoundException({ code: "NOT_FOUND", message: "Recurso no encontrado." });
}

/**
 * CAPA DE ACCESO CON PROPIETARIO.
 *
 * Regla del proyecto: ningún servicio de dominio busca un recurso solo por `id`. Siempre se resuelve a
 * través de este servicio (o con un `where` que incluya `ownerId`), y el `ownerId` sale SIEMPRE de la
 * sesión autenticada, nunca de la petición.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async folder(ownerId: string, id: string, db: Db = this.prisma.client) {
    const folder = await db.folder.findFirst({
      where: { id, ownerId },
      select: { id: true, parentId: true, name: true },
    });
    if (!folder) throw notFound();
    return folder;
  }

  /** `null`/`undefined` significan "sin carpeta" (raíz); un ID ajeno o inexistente → 404. */
  async optionalFolder(ownerId: string, id: string | null | undefined, db: Db = this.prisma.client) {
    if (id === null || id === undefined) return null;
    return this.folder(ownerId, id, db);
  }

  /** Devuelve el grafo aunque esté en la papelera; quien llama decide qué hacer con `deletedAt`. */
  async graph(ownerId: string, id: string, db: Db = this.prisma.client) {
    const graph = await db.graph.findFirst({
      where: { id, ownerId },
      select: { id: true, folderId: true, name: true, description: true, deletedAt: true },
    });
    if (!graph) throw notFound();
    return graph;
  }

  /**
   * Ejecuta `fn` en una transacción que SERIALIZA las operaciones estructurales de un mismo usuario
   * (mover carpetas, aplicar límites, borrar carpetas...). Sin esto, dos movimientos simultáneos
   * podrían crear un ciclo en el árbol aunque cada uno fuera válido por separado.
   * El bloqueo es sobre la fila del propio usuario, así que no afecta a otros usuarios.
   */
  withOwnerLock<T>(ownerId: string, fn: (tx: Db) => Promise<T>, timeoutMs = 20_000): Promise<T> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`;
        return fn(tx);
      },
      { timeout: timeoutMs, maxWait: 10_000 },
    );
  }
}
