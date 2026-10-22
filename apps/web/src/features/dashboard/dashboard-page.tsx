import { ENTITY_CATALOG, type EntityTypeId, isEntityTypeId } from "@a-link/shared";
import { FileDown, Folder, GitFork, type LucideIcon, Network, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { EmptyState, PageHeader, QueryError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/queries";
import { GraphDialog } from "@/features/library/dialogs";
import { useDashboard, useFolders } from "@/features/library/queries";
import { formatNumber, formatRelative, pluralize } from "@/lib/format";

function Stat({ icon: Icon, label, value, to }: { icon: LucideIcon; label: string; value: number; to?: string }) {
  const body = (
    <Card className="flex items-center gap-4 p-4 transition-shadow hover:shadow-md">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-2xl leading-none font-semibold tabular-nums">{formatNumber(value)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
  return to ? (
    <Link to={to} className="rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

function typeInfo(type: string): { name: string; color: string } {
  if (isEntityTypeId(type)) {
    const def = ENTITY_CATALOG[type as EntityTypeId];
    return { name: def.name, color: def.defaultColor };
  }
  return { name: type, color: "#64748b" };
}

export function DashboardPage() {
  const me = useMe();
  const dashboard = useDashboard();
  const folders = useFolders();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const name = me.data?.displayName || me.data?.email.split("@")[0] || "";

  const newGraphButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" /> Nuevo grafo
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={name ? `Hola, ${name}` : "Panel"} description="Resumen de tu espacio de trabajo." actions={newGraphButton} />

      {dashboard.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Cargando">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : dashboard.isError ? (
        <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <section aria-label="Estadísticas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat icon={Network} label="Grafos" value={dashboard.data.counts.graphs} to="/graphs" />
            <Stat icon={Folder} label="Carpetas" value={dashboard.data.counts.folders} to="/graphs" />
            <Stat icon={Users} label="Entidades" value={dashboard.data.counts.nodes} />
            <Stat icon={GitFork} label="Relaciones" value={dashboard.data.counts.edges} />
            <Stat icon={FileDown} label="Exportaciones guardadas" value={dashboard.data.counts.exports} to="/exports" />
            <Stat icon={Trash2} label="En la papelera" value={dashboard.data.counts.trashedGraphs} to="/trash" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
            <Card>
              <CardHeader>
                <CardTitle>Grafos recientes</CardTitle>
                <CardDescription>Los últimos que has modificado.</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard.data.recentGraphs.length === 0 ? (
                  <EmptyState
                    icon={Network}
                    title="Todavía no tienes grafos"
                    description="Crea el primero para empezar a mapear relaciones."
                    action={newGraphButton}
                  />
                ) : (
                  <ul className="divide-y">
                    {dashboard.data.recentGraphs.map((g) => (
                      <li key={g.id}>
                        <Link to={`/graphs/${g.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-accent/50">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{g.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {pluralize(g.nodeCount, "entidad", "entidades")} · {pluralize(g.edgeCount, "relación", "relaciones")}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(g.updatedAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Entidades por tipo</CardTitle>
                <CardDescription>Suma de todos tus grafos activos.</CardDescription>
              </CardHeader>
              <CardContent>
                {Object.keys(dashboard.data.nodesByType).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay entidades.</p>
                ) : (
                  <TypeBars byType={dashboard.data.nodesByType} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {creating && (
        <GraphDialog
          open
          onOpenChange={(o) => !o && setCreating(false)}
          mode={{ type: "create", folderId: null }}
          folders={folders.data ?? []}
          onCreated={(g) => navigate(`/graphs/${g.id}`)}
        />
      )}
    </div>
  );
}

function TypeBars({ byType }: { byType: Record<string, number> }) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return (
    <ul className="grid gap-3">
      {entries.map(([type, count]) => {
        const info = typeInfo(type);
        return (
          <li key={type} className="grid gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: info.color }} aria-hidden="true" />
                {info.name}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatNumber(count)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, backgroundColor: info.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
