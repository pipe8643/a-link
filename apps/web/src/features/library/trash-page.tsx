import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CardGridSkeleton, EmptyState, PageHeader, QueryError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateTime, pluralize } from "@/lib/format";
import type { GraphSummary } from "@/lib/types";
import { toast } from "sonner";
import { ConfirmDialog } from "./dialogs";
import { useDeleteGraphPermanently, useGraphs } from "./queries";
import { useGraphActions } from "./use-graph-actions";

export function TrashPage() {
  const graphs = useGraphs({ trashed: true, pageSize: 50, sort: "deletedAt", order: "desc" });
  const actions = useGraphActions();
  const del = useDeleteGraphPermanently();
  const [target, setTarget] = useState<GraphSummary | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Papelera"
        description="Los grafos eliminados se conservan aquí hasta que los borres definitivamente. Puedes restaurarlos con todas sus entidades y relaciones."
      />

      {graphs.isPending ? (
        <CardGridSkeleton count={3} />
      ) : graphs.isError ? (
        <QueryError error={graphs.error} onRetry={() => void graphs.refetch()} />
      ) : graphs.data.items.length === 0 ? (
        <EmptyState icon={Trash2} title="La papelera está vacía" description="Los grafos que elimines aparecerán aquí." />
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {graphs.data.items.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pluralize(g.nodeCount, "entidad", "entidades")} · {pluralize(g.edgeCount, "relación", "relaciones")}
                    {g.deletedAt && ` · eliminado el ${formatDateTime(g.deletedAt)}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void actions.restore(g)} disabled={actions.busy}>
                  <RotateCcw aria-hidden="true" /> Restaurar
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setTarget(g)}>
                  <Trash2 aria-hidden="true" /> Borrar definitivamente
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {target && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={`Borrar «${target.name}» definitivamente`}
          description="Se eliminarán el grafo, todas sus entidades y relaciones. Esta acción no se puede deshacer."
          confirmLabel="Borrar definitivamente"
          destructive
          onConfirm={async () => {
            await del.mutateAsync(target.id);
            toast.success("Grafo eliminado definitivamente");
          }}
        />
      )}
    </div>
  );
}
