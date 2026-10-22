import {
  ENTITY_CATALOG,
  EDGE_DIRECTIONS,
  EVIDENCE_CLASSES,
  EVIDENCE_LABELS_ES,
  RELATIONSHIP_LABELS_ES,
  RELATIONSHIP_TYPES,
  type GraphEdgeData,
  type GraphNodeData,
} from "@a-link/shared";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  emptyRelationshipForm,
  newId,
  parseRelationshipForm,
  relationshipToForm,
  type RelationshipFormValues,
} from "./editor-commands";

const DIRECTION_LABELS = {
  forward: "Del origen al destino (→)",
  both: "En ambos sentidos (↔)",
  none: "Sin dirección (—)",
} as const;

const EVIDENCE_HINTS = {
  recorded: "Línea continua. Úsalo solo si consta en un registro o documento.",
  hypothesis: "Línea discontinua. Es lo que se asume por defecto: nada se da por verificado.",
  observation: "Línea punteada. Algo que se ha observado pero no está documentado.",
} as const;

export type RelationshipDialogMode = { type: "new"; sourceId?: string; targetId?: string } | { type: "edit"; edge: GraphEdgeData };

interface Props {
  mode: RelationshipDialogMode | null;
  nodes: readonly GraphNodeData[];
  edges: readonly GraphEdgeData[];
  onClose(): void;
  onSubmit(edge: GraphEdgeData, isNew: boolean): void;
}

export function RelationshipDialog({ mode, nodes, edges, onClose, onSubmit }: Props) {
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">{mode ? <RelationshipForm key={mode.type === "edit" ? mode.edge.id : "new"} mode={mode} nodes={nodes} edges={edges} onClose={onClose} onSubmit={onSubmit} /> : null}</DialogContent>
    </Dialog>
  );
}

function RelationshipForm({ mode, nodes, edges, onClose, onSubmit }: Omit<Props, "mode"> & { mode: RelationshipDialogMode }) {
  const isNew = mode.type === "new";
  const [id] = useState(() => (mode.type === "edit" ? mode.edge.id : newId()));
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, setFocus, watch, formState } = useForm<RelationshipFormValues>({
    defaultValues: mode.type === "edit" ? relationshipToForm(mode.edge) : emptyRelationshipForm(mode.sourceId ?? "", mode.targetId ?? ""),
  });
  const { errors } = formState;
  const evidence = watch("evidenceClass");

  useEffect(() => {
    setFocus(isNew && !mode.sourceId ? "sourceId" : isNew && !mode.targetId ? "targetId" : "relationshipType");
  }, [isNew, mode, setFocus]);

  const submit = handleSubmit((values) => {
    setFormError(null);
    const r = parseRelationshipForm(id, values, edges, isNew);
    if (!r.ok) {
      let shown = false;
      for (const [field, message] of Object.entries(r.errors)) {
        if (field in values) {
          setError(field as keyof RelationshipFormValues, { type: "validate", message });
          shown = true;
        }
      }
      if (!shown || r.errors._form) setFormError(r.errors._form ?? "Revisa los datos de la relación.");
      return;
    }
    onSubmit(r.value, isNew);
  });

  const nodeOptions = nodes.map((n) => (
    <option key={n.id} value={n.id}>
      {n.label} ({ENTITY_CATALOG[n.type].name})
    </option>
  ));

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isNew ? "Nueva relación" : "Editar relación"}</DialogTitle>
        <DialogDescription>Une dos entidades y deja claro qué tan sólido es el vínculo.</DialogDescription>
      </DialogHeader>
      <FormError message={formError} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Origen" error={errors.sourceId?.message} {...register("sourceId")}>
          <option value="">Selecciona…</option>
          {nodeOptions}
        </SelectField>
        <SelectField label="Destino" error={errors.targetId?.message} {...register("targetId")}>
          <option value="">Selecciona…</option>
          {nodeOptions}
        </SelectField>
        <SelectField label="Tipo de relación" error={errors.relationshipType?.message} {...register("relationshipType")}>
          {RELATIONSHIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {RELATIONSHIP_LABELS_ES[t]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Dirección" error={errors.direction?.message} {...register("direction")}>
          {EDGE_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {DIRECTION_LABELS[d]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="Etiqueta (opcional)" maxLength={200} error={errors.label?.message} hint="Si la dejas vacía se muestra el tipo de relación." {...register("label")} />
      <SelectField
        label="Naturaleza del dato"
        error={errors.evidenceClass?.message}
        hint={EVIDENCE_HINTS[evidence]}
        {...register("evidenceClass")}
      >
        {EVIDENCE_CLASSES.map((c) => (
          <option key={c} value={c}>
            {EVIDENCE_LABELS_ES[c]}
          </option>
        ))}
      </SelectField>
      <p className="-mt-2 text-xs text-muted-foreground">
        Registrado = línea continua · Hipótesis = discontinua · Observación = punteada.
      </p>
      <TextAreaField label="Descripción (opcional)" rows={3} maxLength={2000} error={errors.description?.message} {...register("description")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Inicio" type="date" error={errors.startDate?.message} {...register("startDate")} />
        <TextField label="Fin" type="date" error={errors.endDate?.message} {...register("endDate")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <TextField label="Fuente (opcional)" maxLength={500} error={errors.source?.message} {...register("source")} />
        <TextField label="Confianza (0–100)" type="number" inputMode="numeric" min={0} max={100} step={1} error={errors.confidence?.message} {...register("confidence")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit">{isNew ? "Crear relación" : "Guardar cambios"}</Button>
      </DialogFooter>
    </form>
  );
}
