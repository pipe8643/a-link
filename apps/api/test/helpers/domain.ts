import { randomUUID } from "node:crypto";
import type { TestApp } from "./test-app.js";

type Agent = ReturnType<TestApp["agent"]>;

/** Vacía las tablas en un orden que respeta las claves foráneas RESTRICT (grafos/exportaciones antes que carpetas). */
export async function resetDatabase(t: TestApp): Promise<void> {
  const db = t.prisma;
  await db.auditLog.deleteMany();
  await db.exportFile.deleteMany();
  await db.graph.deleteMany();
  await db.folder.updateMany({ data: { parentId: null } });
  await db.folder.deleteMany();
  await db.user.deleteMany();
}

export async function mkFolder(agent: Agent, name: string, parentId?: string | null): Promise<string> {
  const res = await agent.post("/api/v1/folders").send({ name, ...(parentId !== undefined ? { parentId } : {}) });
  if (res.status !== 201) throw new Error(`mkFolder falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.folder.id as string;
}

export async function mkGraph(agent: Agent, name: string, folderId?: string | null): Promise<string> {
  const res = await agent.post("/api/v1/graphs").send({ name, ...(folderId !== undefined ? { folderId } : {}) });
  if (res.status !== 201) throw new Error(`mkGraph falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.graph.id as string;
}

/** Inserta contenido directamente en BD (la API de nodos/aristas llega en la Fase 5). Devuelve los ids creados. */
export async function seedContent(t: TestApp, graphId: string, nodeCount: number, edgeCount: number) {
  const nodeIds: string[] = Array.from({ length: nodeCount }, () => randomUUID());
  await t.prisma.graphNode.createMany({
    data: nodeIds.map((id, i) => ({
      id,
      graphId,
      type: i % 2 === 0 ? "person" : "phone",
      label: `Entidad ${i}`,
      tags: ["demo", `n${i}`],
      metadata: { nota: `m${i}` },
      positionX: i * 10,
      positionY: i * 5,
    })),
  });
  const edgeIds: string[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const id = randomUUID();
    edgeIds.push(id);
    await t.prisma.graphEdge.create({
      data: {
        id,
        graphId,
        sourceNodeId: nodeIds[i % nodeCount]!,
        targetNodeId: nodeIds[(i + 1) % nodeCount]!,
        relationshipType: "knows",
        label: `rel ${i}`,
        metadata: { evidenceClass: "hypothesis" },
      },
    });
  }
  return { nodeIds, edgeIds };
}

/** Quita el requestId para comparar cuerpos de error entre respuestas distintas. */
export function errorShape(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, requestId: "-" };
}
