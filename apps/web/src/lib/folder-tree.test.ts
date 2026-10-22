import { describe, expect, it } from "vitest";
import { buildTree, flatten, folderDepth, folderName, folderOptions, folderPath, subtreeIds } from "./folder-tree";
import type { Folder } from "./types";

const f = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const sample = [f("c", "Zeta"), f("a", "Alfa"), f("a2", "alfa dos", "a"), f("a1", "Álamo", "a"), f("b", "Beta"), f("b1", "Hija", "b")];

describe("buildTree", () => {
  it("ordena por nombre sin distinguir mayúsculas/acentos y calcula la profundidad", () => {
    const tree = buildTree(sample);
    expect(tree.map((n) => n.folder.name)).toEqual(["Alfa", "Beta", "Zeta"]);
    const alfa = tree[0]!;
    expect(alfa.children.map((n) => n.folder.name)).toEqual(["Álamo", "alfa dos"]);
    expect(alfa.children.every((n) => n.depth === 1)).toBe(true);
  });

  it("una carpeta con padre inexistente cuelga de la raíz (no desaparece)", () => {
    const tree = buildTree([f("x", "Huérfana", "no-existe"), f("y", "Normal")]);
    expect(tree.map((n) => n.folder.name).sort()).toEqual(["Huérfana", "Normal"]);
  });

  it("datos cíclicos corruptos no provocan recursión infinita", () => {
    const tree = buildTree([f("a", "A", "b"), f("b", "B", "a"), f("c", "C")]);
    expect(Array.isArray(tree)).toBe(true);
    expect(flatten(tree).length).toBeLessThanOrEqual(3);
  });

  it("lista vacía", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("subtreeIds / folderPath / folderDepth", () => {
  it("subtreeIds incluye la carpeta y todos sus descendientes", () => {
    expect([...subtreeIds(sample, "a")].sort()).toEqual(["a", "a1", "a2"]);
    expect([...subtreeIds(sample, "c")]).toEqual(["c"]);
  });

  it("folderPath devuelve la cadena desde la raíz", () => {
    expect(folderPath(sample, "a2").map((x) => x.id)).toEqual(["a", "a2"]);
    expect(folderPath(sample, null)).toEqual([]);
    expect(folderPath(sample, "no-existe")).toEqual([]);
    expect(folderDepth(sample, "a2")).toBe(2);
  });

  it("folderPath tolera ciclos", () => {
    expect(folderPath([f("a", "A", "b"), f("b", "B", "a")], "a").length).toBeLessThanOrEqual(2);
  });
});

describe("folderOptions", () => {
  it("indenta por nivel y excluye la carpeta movida y su subárbol", () => {
    const all = folderOptions(sample).map((o) => o.id);
    expect(all).toEqual(["a", "a1", "a2", "b", "b1", "c"]);
    const withoutA = folderOptions(sample, subtreeIds(sample, "a")).map((o) => o.id);
    expect(withoutA).toEqual(["b", "b1", "c"]);
    expect(folderOptions(sample).find((o) => o.id === "a2")!.label.startsWith("\u2003")).toBe(true);
  });
});

describe("folderName", () => {
  it("devuelve el nombre o null", () => {
    expect(folderName(sample, "b")).toBe("Beta");
    expect(folderName(sample, null)).toBeNull();
    expect(folderName(sample, "zzz")).toBeNull();
  });
});
