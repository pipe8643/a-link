import { ConflictException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { MAX_FOLDERS_PER_USER, MAX_FOLDER_DEPTH } from "../common/limits.js";
import { type Db, OwnershipService } from "../common/ownership.service.js";
import { PrismaService } from "../db/prisma.service.js";
import type { DeleteMode } from "./dto.js";

interface TreeRow {
  id: string;
  parentId: string | null;
}
type Tree = Map<string, TreeRow>;

const FOLDER_SELECT = { id: true, parentId: true, name: true, createdAt: true, updatedAt: true } as const;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/** Número de carpetas desde la raíz hasta `id` (una carpeta en la raíz = 1; `null` = 0). */
export function depthOf(tree: Tree, id: string | null): number {
  let depth = 0;
  const seen = new Set<string>();
  for (let cur = id; cur; cur = tree.get(cur)?.parentId ?? null) {
    if (seen.has(cur)) break; // protección ante datos corruptos: nunca bucle infinito
    seen.add(cur);
    depth++;
  }
  return depth;
}

function childrenIndex(tree: Tree): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of tree.values()) {
    if (!row.parentId) continue;
    const list = index.get(row.parentId) ?? [];
    list.push(row.id);
    index.set(row.parentId, list);
  }
  return index;
}

/** Ids de `id` y todos sus descendientes. */
export function subtreeIds(tree: Tree, id: string): string[] {
  const index = childrenIndex(tree);
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(index.get(cur) ?? []));
  }
  return out;
}

/** Altura del subárbol que cuelga de `id`, contando la propia carpeta (una hoja = 1). */
export function subtreeHeight(tree: Tree, id: string): number {
  const index = childrenIndex(tree);
  let height = 0;
  let level = [id];
  const seen = new Set<string>();
  while (level.length) {
    height++;
    const next: string[] = [];
    for (const cur of level) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      next.push(...(index.get(cur) ?? []));
    }
    level = next;
  }
  return height;
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditService,
  ) {}

  private async loadTree(ownerId: string, db: Db): Promise<Tree> {
    const rows = await db.folder.findMany({ where: { ownerId }, select: { id: true, parentId: true } });
    return new Map(rows.map((r) => [r.id, r]));
  }

  async list(ownerId: string) {
    const rows = await this.prisma.client.folder.findMany({
      where: { ownerId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { ...FOLDER_SELECT, _count: { select: { graphs: { where: { deletedAt: null } } } } },
    });
    return { items: rows.map(({ _count, ...f }) => ({ ...f, graphCount: _count.graphs })) };
  }

  async get(ownerId: string, id: string) {
    await this.ownership.folder(ownerId, id);
    const row = await this.prisma.client.folder.findFirstOrThrow({
      where: { id, ownerId },
      select: {
        ...FOLDER_SELECT,
        _count: { select: { children: true, graphs: { where: { deletedAt: null } } } },
      },
    });
    const { _count, ...folder } = row;
    return { ...folder, childCount: _count.children, graphCount: _count.graphs };
  }

  async create(ownerId: string, input: { name: string; parentId?: string | null }) {
    const folder = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const total = await tx.folder.count({ where: { ownerId } });
      if (total >= MAX_FOLDERS_PER_USER) {
        throw conflict("FOLDER_LIMIT_REACHED", `Se alcanzó el máximo de ${MAX_FOLDERS_PER_USER} carpetas.`);
      }
      const parent = await this.ownership.optionalFolder(ownerId, input.parentId, tx);
      if (parent) {
        const tree = await this.loadTree(ownerId, tx);
        if (depthOf(tree, parent.id) + 1 > MAX_FOLDER_DEPTH) {
          throw conflict("FOLDER_TOO_DEEP", `Las carpetas admiten como máximo ${MAX_FOLDER_DEPTH} niveles.`);
        }
      }
      return tx.folder.create({
        data: { ownerId, name: input.name, parentId: parent?.id ?? null },
        select: FOLDER_SELECT,
      });
    });
    await this.audit.record({ actorId: ownerId, action: "folder.created", resourceType: "folder", resourceId: folder.id });
    return folder;
  }

  async update(ownerId: string, id: string, input: { name?: string; parentId?: string | null }) {
    const folder = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      await this.ownership.folder(ownerId, id, tx);
      const data: { name?: string; parentId?: string | null } = {};
      if (input.name !== undefined) data.name = input.name;

      if (input.parentId !== undefined) {
        if (input.parentId !== null) {
          const parent = await this.ownership.folder(ownerId, input.parentId, tx);
          const tree = await this.loadTree(ownerId, tx);
          // Ciclo: el nuevo padre no puede ser la propia carpeta ni uno de sus descendientes.
          if (subtreeIds(tree, id).includes(parent.id)) {
            throw conflict("FOLDER_CYCLE", "No se puede mover una carpeta dentro de sí misma o de sus subcarpetas.");
          }
          if (depthOf(tree, parent.id) + subtreeHeight(tree, id) > MAX_FOLDER_DEPTH) {
            throw conflict("FOLDER_TOO_DEEP", `Las carpetas admiten como máximo ${MAX_FOLDER_DEPTH} niveles.`);
          }
        }
        data.parentId = input.parentId;
      }

      if (Object.keys(data).length > 0) {
        await tx.folder.updateMany({ where: { id, ownerId }, data });
      }
      return tx.folder.findFirstOrThrow({ where: { id, ownerId }, select: FOLDER_SELECT });
    });
    await this.audit.record({
      actorId: ownerId,
      action: "folder.updated",
      resourceType: "folder",
      resourceId: id,
      metadata: { renamed: input.name !== undefined, moved: input.parentId !== undefined },
    });
    return folder;
  }

  async remove(ownerId: string, id: string, mode: DeleteMode | undefined) {
    const summary = await this.ownership.withOwnerLock(ownerId, async (tx) => {
      const folder = await this.ownership.folder(ownerId, id, tx);
      const tree = await this.loadTree(ownerId, tx);
      const childFolders = [...tree.values()].filter((r) => r.parentId === id).length;
      const [graphs, exports] = await Promise.all([
        tx.graph.count({ where: { ownerId, folderId: id } }),
        tx.exportFile.count({ where: { ownerId, folderId: id } }),
      ]);

      if (!mode) {
        if (childFolders + graphs + exports > 0) {
          throw conflict(
            "FOLDER_NOT_EMPTY",
            "La carpeta no está vacía. Indica qué hacer con su contenido (contents=move_to_parent | trash).",
          );
        }
        await tx.folder.deleteMany({ where: { id, ownerId } });
        return { mode: "empty", folders: 1, graphs: 0 };
      }

      if (mode === "move_to_parent") {
        const target = folder.parentId;
        await tx.folder.updateMany({ where: { ownerId, parentId: id }, data: { parentId: target } });
        await tx.graph.updateMany({ where: { ownerId, folderId: id }, data: { folderId: target } });
        await tx.exportFile.updateMany({ where: { ownerId, folderId: id }, data: { folderId: target } });
        await tx.folder.deleteMany({ where: { id, ownerId } });
        return { mode, folders: 1, graphs: graphs };
      }

      // mode === "trash": grafos activos a la papelera y se elimina todo el subárbol.
      const ids = subtreeIds(tree, id);
      const trashed = await tx.graph.updateMany({
        where: { ownerId, folderId: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      // Los grafos (y exportaciones) dejan de apuntar a carpetas que van a desaparecer.
      await tx.graph.updateMany({ where: { ownerId, folderId: { in: ids } }, data: { folderId: null } });
      await tx.exportFile.updateMany({ where: { ownerId, folderId: { in: ids } }, data: { folderId: null } });
      // De las hojas hacia la raíz (la clave foránea del padre es RESTRICT).
      const deepestFirst = [...ids].sort((a, b) => depthOf(tree, b) - depthOf(tree, a));
      for (const folderId of deepestFirst) await tx.folder.deleteMany({ where: { id: folderId, ownerId } });
      return { mode, folders: ids.length, graphs: trashed.count };
    });
    await this.audit.record({
      actorId: ownerId,
      action: "folder.deleted",
      resourceType: "folder",
      resourceId: id,
      metadata: { mode: summary.mode, folders: summary.folders, graphs: summary.graphs },
    });
  }
}
