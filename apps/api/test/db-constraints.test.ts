import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../src/db/prisma-client.js";

/**
 * Pruebas de integridad contra una base MySQL REAL (migraciones ya aplicadas).
 * Se omiten si no hay TEST_DATABASE_URL. ATENCIÓN: vacía las tablas de esa base de datos;
 * usa SIEMPRE una base de pruebas desechable, nunca la de desarrollo.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("restricciones de integridad en MySQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(url as string);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.exportFile.deleteMany();
    await prisma.graphEdge.deleteMany();
    await prisma.graphNode.deleteMany();
    await prisma.graph.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedUserWithGraphs() {
    const user = await prisma.user.create({
      data: { email: "demo@example.test", passwordHash: "hash-de-prueba" },
    });
    const graphA = await prisma.graph.create({ data: { ownerId: user.id, name: "Grafo A" } });
    const graphB = await prisma.graph.create({ data: { ownerId: user.id, name: "Grafo B" } });
    const node = (graphId: string, label: string) =>
      prisma.graphNode.create({
        data: { graphId, type: "person", label, tags: [], metadata: {} },
      });
    return {
      user,
      graphA,
      graphB,
      a1: await node(graphA.id, "A1"),
      a2: await node(graphA.id, "A2"),
      b1: await node(graphB.id, "B1"),
    };
  }

  it("guarda y recupera tags (array) y metadata (objeto) JSON sin perder datos", async () => {
    const { graphA } = await seedUserWithGraphs();
    const n = await prisma.graphNode.create({
      data: {
        graphId: graphA.id,
        type: "vehicle",
        label: "Vehículo demo",
        tags: ["demo", "sintético"],
        metadata: { make: "Marca", plate: "ABC-123" },
        positionX: 10.5,
        positionY: -3,
      },
    });
    const back = await prisma.graphNode.findUniqueOrThrow({ where: { id: n.id } });
    expect(back.tags).toEqual(["demo", "sintético"]);
    expect(back.metadata).toEqual({ make: "Marca", plate: "ABC-123" });
    expect(back.positionX).toBe(10.5);
    expect(back.id).toHaveLength(36);
  });

  it("acepta una arista entre dos nodos del mismo grafo", async () => {
    const { graphA, a1, a2 } = await seedUserWithGraphs();
    const e = await prisma.graphEdge.create({
      data: {
        graphId: graphA.id,
        sourceNodeId: a1.id,
        targetNodeId: a2.id,
        relationshipType: "association",
        metadata: { evidenceClass: "hypothesis" },
      },
    });
    expect(e.id).toBeTruthy();
  });

  it("RECHAZA una arista cuyo destino pertenece a OTRO grafo (FK compuesta)", async () => {
    const { graphA, a1, b1 } = await seedUserWithGraphs();
    await expect(
      prisma.graphEdge.create({
        data: {
          graphId: graphA.id,
          sourceNodeId: a1.id,
          targetNodeId: b1.id,
          relationshipType: "association",
          metadata: {},
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.graphEdge.count()).toBe(0);
  });

  it("RECHAZA una arista de un nodo consigo mismo", async () => {
    const { graphA, a1 } = await seedUserWithGraphs();
    await expect(
      prisma.graphEdge.create({
        data: {
          graphId: graphA.id,
          sourceNodeId: a1.id,
          targetNodeId: a1.id,
          relationshipType: "association",
          metadata: {},
        },
      }),
    ).rejects.toThrow();
  });

  it("RECHAZA metadata que no sea un objeto y tags que no sea un array", async () => {
    const { graphA } = await seedUserWithGraphs();
    await expect(
      prisma.graphNode.create({
        data: { graphId: graphA.id, type: "person", label: "x", tags: [], metadata: [1, 2] },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.graphNode.create({
        data: { graphId: graphA.id, type: "person", label: "x", tags: { a: 1 }, metadata: {} },
      }),
    ).rejects.toThrow();
  });

  it("RECHAZA correos con mayúsculas aunque la collation no distinga mayúsculas", async () => {
    await expect(
      prisma.user.create({ data: { email: "Mayusculas@Example.test", passwordHash: "h" } }),
    ).rejects.toThrow();
  });

  it("el correo es único sin distinguir mayúsculas (collation _ci)", async () => {
    await prisma.user.create({ data: { email: "unico@example.test", passwordHash: "h" } });
    await expect(
      prisma.user.create({ data: { email: "unico@example.test", passwordHash: "h" } }),
    ).rejects.toThrow();
  });

  it("RECHAZA una carpeta que sea su propio padre", async () => {
    const { user } = await seedUserWithGraphs();
    const f = await prisma.folder.create({ data: { ownerId: user.id, name: "F" } });
    await expect(
      prisma.folder.update({ where: { id: f.id }, data: { parentId: f.id } }),
    ).rejects.toThrow();
  });

  it("no permite borrar una carpeta que aún contiene grafos (Restrict)", async () => {
    const { user } = await seedUserWithGraphs();
    const f = await prisma.folder.create({ data: { ownerId: user.id, name: "Con grafos" } });
    await prisma.graph.create({ data: { ownerId: user.id, folderId: f.id, name: "Dentro" } });
    await expect(prisma.folder.delete({ where: { id: f.id } })).rejects.toThrow();
  });

  it("al borrar un nodo se borran sus aristas; al borrar un grafo, nodos y aristas", async () => {
    const { graphA, a1, a2 } = await seedUserWithGraphs();
    await prisma.graphEdge.create({
      data: {
        graphId: graphA.id,
        sourceNodeId: a1.id,
        targetNodeId: a2.id,
        relationshipType: "contact",
        metadata: {},
      },
    });
    await prisma.graphNode.delete({ where: { id: a1.id } });
    expect(await prisma.graphEdge.count({ where: { graphId: graphA.id } })).toBe(0);

    await prisma.graph.delete({ where: { id: graphA.id } });
    expect(await prisma.graphNode.count({ where: { graphId: graphA.id } })).toBe(0);
  });

  it("revision no puede ser menor que 1 y fileSize debe ser positivo", async () => {
    const { user, graphA } = await seedUserWithGraphs();
    await expect(
      prisma.graph.update({ where: { id: graphA.id }, data: { revision: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.exportFile.create({
        data: {
          ownerId: user.id,
          graphId: graphA.id,
          name: "x",
          format: "PNG",
          storageKey: "exports/test/clave-1",
          fileSize: 0,
          sha256: "0".repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it("el control de concurrencia optimista (revision) detecta el cambio previo", async () => {
    const { graphA } = await seedUserWithGraphs();
    const bump = (expected: number) =>
      prisma.graph.updateMany({
        where: { id: graphA.id, revision: expected },
        data: { revision: { increment: 1 }, name: `v${expected}` },
      });
    expect((await bump(1)).count).toBe(1); // primera escritura gana
    expect((await bump(1)).count).toBe(0); // segunda con revisión obsoleta: conflicto
    expect((await prisma.graph.findUniqueOrThrow({ where: { id: graphA.id } })).revision).toBe(2);
  });
});
