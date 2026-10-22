import type { Folder } from "./types";

export interface FolderNode {
  folder: Folder;
  depth: number;
  children: FolderNode[];
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Árbol ordenado por nombre. Las carpetas con padre inexistente cuelgan de la raíz (nunca se pierden). */
export function buildTree(folders: Folder[]): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const nodes = new Map<string, FolderNode>(folders.map((f) => [f.id, { folder: f, depth: 0, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.folder.parentId;
    const parent = parentId && byId.has(parentId) ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortAndDepth = (list: FolderNode[], depth: number, seen: Set<string>) => {
    list.sort((a, b) => collator.compare(a.folder.name, b.folder.name));
    for (const n of list) {
      if (seen.has(n.folder.id)) continue; // protección ante datos cíclicos: no hay recursión infinita
      seen.add(n.folder.id);
      n.depth = depth;
      sortAndDepth(n.children, depth + 1, seen);
    }
  };
  sortAndDepth(roots, 0, new Set());
  return roots;
}

/** Recorrido en profundidad respetando el orden del árbol. */
export function flatten(tree: FolderNode[]): FolderNode[] {
  return tree.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Ids de la carpeta y todos sus descendientes. */
export function subtreeIds(folders: Folder[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    children.set(f.parentId, [...(children.get(f.parentId) ?? []), f.id]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}

/** Cadena de carpetas desde la raíz hasta `id` (vacía si no existe). */
export function folderPath(folders: Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  for (let cur = id ? byId.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    path.unshift(cur);
  }
  return path;
}

export function folderDepth(folders: Folder[], id: string | null): number {
  return folderPath(folders, id).length;
}

export interface FolderOption {
  id: string;
  label: string;
  depth: number;
}

/** Opciones para un <select>: con sangría por nivel y excluyendo carpetas (p. ej. la movida y su subárbol). */
export function folderOptions(folders: Folder[], exclude: ReadonlySet<string> = new Set()): FolderOption[] {
  return flatten(buildTree(folders))
    .filter((n) => !exclude.has(n.folder.id))
    .map((n) => ({ id: n.folder.id, depth: n.depth, label: `${"\u2003".repeat(n.depth)}${n.folder.name}` }));
}

export function folderName(folders: Folder[], id: string | null): string | null {
  return id ? (folders.find((f) => f.id === id)?.name ?? null) : null;
}
