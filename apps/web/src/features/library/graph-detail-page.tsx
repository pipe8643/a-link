import { ArrowLeft, Copy, GitFork, Network, Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader, QueryError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { folderPath } from "@/lib/folder-tree";
import { formatDateTime, formatNumber } from "@/lib/format";
import { NotFoundView } from "@/pages/not-found";
import { GraphDialog } from "./dialogs";
import { useFolders, useGraph } from "./queries";
import { useGraphActions } from "./use-graph-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ficha del grafo: datos reales y acceso al editor interactivo (`/graphs/:id/editor`).
 */
export function GraphDetailPage() {
  const { graphId = "" } = useParams();
  // Un identificador mal formado nunca llega a la API.
  return UUID_RE.test(graphId) ? <GraphDetail graphId={graphId} /> : <NotFoundView />;
}

function GraphDetail({ graphId }: { graphId: string }) {
  const navigate = useNavigate();
  const graph = useGraph(graphId);
  const folders = useFolders();
  const actions = useGraphActions();
  const [editing, setEditing] = useState(false);

  if (graph.isPending) return <Skeleton className="h-64" />;
  if (graph.isError) {
    return isApiError(graph.error) && graph.error.status === 404 ? (
      <NotFoundView />
    ) : (
      <QueryError error={graph.error} onRetry={() => void graph.refetch()} />
    );
  }

  const g = graph.data;
  const path = folderPath(folders.data ?? [], g.folderId);

  return (
    <div className="grid gap-6">
      <Link to="/graphs" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Volver a grafos
      </Link>

      <PageHeader
        title={g.name}
        description={
          <>
            {path.length > 0 ? path.map((f) => f.name).join(" / ") : "Sin carpeta"} · actualizado el {formatDateTime(g.updatedAt)}
          </>
        }
        actions={
          g.deletedAt ? (
            <Badge variant="destructive">En la papelera</Badge>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Editar detalles
              </Button>
              <Button variant="outline" onClick={() => void actions.duplicate(g)}>
                <Copy aria-hidden="true" /> Duplicar
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await actions.trash(g);
                  navigate("/graphs");
                }}
              >
                <Trash2 aria-hidden="true" /> Papelera
              </Button>
            </>
          )
        }
      />

      {g.description && <p className="max-w-3xl text-sm whitespace-pre-wrap">{g.description}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4 p-4">
          <Users className="size-8 text-primary/70" aria-hidden="true" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatNumber(g.nodeCount)}</p>
            <p className="text-sm text-muted-foreground">Entidades</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <GitFork className="size-8 text-primary/70" aria-hidden="true" />
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatNumber(g.edgeCount)}</p>
            <p className="text-sm text-muted-foreground">Relaciones</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4" aria-hidden="true" /> Editor de relaciones
          </CardTitle>
          <CardDescription>
            Añade entidades, únelas con relaciones, muévelas en el lienzo y edita sus datos. En esta fase los cambios aún no se guardan: el
            guardado automático llega en la siguiente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {g.deletedAt ? null : (
            <Button asChild>
              <Link to={`/graphs/${g.id}/editor`}>
                <Pencil aria-hidden="true" /> Abrir editor
              </Link>
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Revisión {g.revision} · formato de datos v{g.graphDataVersion}
          </span>
        </CardContent>
      </Card>

      {editing && (
        <GraphDialog open onOpenChange={(o) => !o && setEditing(false)} mode={{ type: "edit", graph: g }} folders={folders.data ?? []} />
      )}
    </div>
  );
}
