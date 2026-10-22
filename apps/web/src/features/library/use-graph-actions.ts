import { useNavigate } from "react-router";
import { toast } from "sonner";
import { describeError } from "@/lib/form-errors";
import type { GraphSummary } from "@/lib/types";
import { useDuplicateGraph, useRestoreGraph, useTrashGraph } from "./queries";

/** Acciones rápidas sobre un grafo, con notificaciones y "Deshacer" al enviar a la papelera. */
export function useGraphActions() {
  const navigate = useNavigate();
  const trash = useTrashGraph();
  const restore = useRestoreGraph();
  const duplicate = useDuplicateGraph();

  return {
    busy: trash.isPending || restore.isPending || duplicate.isPending,

    async trash(graph: Pick<GraphSummary, "id" | "name">) {
      try {
        await trash.mutateAsync(graph.id);
        toast.success(`«${graph.name}» enviado a la papelera`, {
          action: {
            label: "Deshacer",
            onClick: () => {
              restore.mutate(graph.id, {
                onSuccess: () => toast.success(`«${graph.name}» restaurado`),
                onError: (err) => toast.error(describeError(err)),
              });
            },
          },
        });
      } catch (err) {
        toast.error(describeError(err));
      }
    },

    async restore(graph: Pick<GraphSummary, "id" | "name">) {
      try {
        await restore.mutateAsync(graph.id);
        toast.success(`«${graph.name}» restaurado`);
      } catch (err) {
        toast.error(describeError(err));
      }
    },

    async duplicate(graph: Pick<GraphSummary, "id" | "name">) {
      try {
        const { graph: copy } = await duplicate.mutateAsync(graph.id);
        toast.success(`Copia creada: «${copy.name}»`, {
          action: { label: "Abrir", onClick: () => navigate(`/graphs/${copy.id}`) },
        });
      } catch (err) {
        toast.error(describeError(err));
      }
    },
  };
}
