import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/auth.guard.js";
import type { AuthContext } from "../common/request-context.js";
import { PrismaService } from "../db/prisma.service.js";

const RECENT = 6;

/** Estadísticas del usuario autenticado. Todas las consultas filtran por el propietario de la sesión. */
@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async summary(@CurrentAuth() auth: AuthContext) {
    const ownerId = auth.userId;
    const db = this.prisma.client;
    const activeGraph = { ownerId, deletedAt: null };
    const [graphs, trashedGraphs, folders, nodes, edges, exportsCount, byType, recent] = await Promise.all([
      db.graph.count({ where: activeGraph }),
      db.graph.count({ where: { ownerId, deletedAt: { not: null } } }),
      db.folder.count({ where: { ownerId } }),
      db.graphNode.count({ where: { graph: activeGraph } }),
      db.graphEdge.count({ where: { graph: activeGraph } }),
      db.exportFile.count({ where: { ownerId } }),
      db.graphNode.groupBy({ by: ["type"], where: { graph: activeGraph }, _count: { _all: true } }),
      db.graph.findMany({
        where: activeGraph,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: RECENT,
        select: { id: true, name: true, folderId: true, updatedAt: true, _count: { select: { nodes: true, edges: true } } },
      }),
    ]);
    return {
      counts: { graphs, trashedGraphs, folders, nodes, edges, exports: exportsCount },
      nodesByType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
      recentGraphs: recent.map(({ _count, ...g }) => ({ ...g, nodeCount: _count.nodes, edgeCount: _count.edges })),
    };
  }
}
