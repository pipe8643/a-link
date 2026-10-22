import { ENTITY_CATALOG, EVIDENCE_LABELS_ES, RELATIONSHIP_LABELS_ES, type GraphEdgeData, type GraphNodeData } from "@a-link/shared";
import { ArrowRight, Crosshair, ImagePlus, Link2, Maximize2, Minimize2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageCropDialog } from "../images/image-crop-dialog";
import { validateSourceFile, ImageSourceError, SOURCE_MIME_TYPES } from "../images/image-output";
import { graphImageUrl, uploadGraphImage } from "../images/queries";
import { entityToForm, parseEntityForm, type EntityFormValues } from "./editor-commands";
import { imageFrameFor } from "./shapes";
import { ShapeIcon } from "./shape-icon";
import type { EditorApi } from "./use-editor";
import type { GraphViewApi } from "./use-graph-view";

interface Props {
  graphId: string;
  editor: EditorApi;
  onConnectFrom(nodeId: string): void;
  onEditEdge(edge: GraphEdgeData): void;
  onDelete(): void;
  onPickEdge(id: string): void;
  graphView?: GraphViewApi;
}

/** Panel derecho: detalles de lo seleccionado (entidad, relación, varios o nada). */
export function RightPanel({ graphId, editor, onConnectFrom, onEditEdge, onDelete, onPickEdge, graphView }: Props) {
  const { selection, nodesById, edgesById, doc } = editor;
  const total = selection.nodeIds.length + selection.edgeIds.length;

  if (total === 0) {
    return (
      <div className="grid gap-2 p-4 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">Detalles</h2>
        <p>Selecciona una entidad o una relación para ver y editar sus datos.</p>
        <p className="text-xs">
          {doc.nodes.length} entidades · {doc.edges.length} relaciones
        </p>
      </div>
    );
  }

  if (total > 1) {
    return (
      <div className="grid gap-3 p-4">
        <h2 className="text-base font-semibold">Selección múltiple</h2>
        <p className="text-sm text-muted-foreground">
          {selection.nodeIds.length} entidades y {selection.edgeIds.length} relaciones seleccionadas.
        </p>
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden="true" /> Eliminar selección
        </Button>
      </div>
    );
  }

  const node = selection.nodeIds[0] ? nodesById.get(selection.nodeIds[0]) : undefined;
  if (node) return <EntityDetails key={node.id} graphId={graphId} node={node} editor={editor} onConnectFrom={onConnectFrom} onDelete={onDelete} onPickEdge={onPickEdge} graphView={graphView} />;

  const edge = selection.edgeIds[0] ? edgesById.get(selection.edgeIds[0]) : undefined;
  return edge ? <RelationshipSummary edge={edge} editor={editor} onEdit={() => onEditEdge(edge)} onDelete={onDelete} /> : null;
}

// ---------------------------------------------------------------------------------------------
function EntityDetails({ graphId, node, editor, onConnectFrom, onDelete, onPickEdge, graphView }: { graphId: string; node: GraphNodeData; editor: EditorApi; onConnectFrom(id: string): void; onDelete(): void; onPickEdge(id: string): void; graphView?: GraphViewApi }) {
  const def = ENTITY_CATALOG[node.type];
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState } = useForm<EntityFormValues>({ defaultValues: entityToForm(node) });
  const { errors, isDirty } = formState;

  // Si la entidad cambia por fuera (deshacer, rehacer…) el formulario se actualiza; mover el nodo no lo reinicia.
  const snapshot = useMemo(() => JSON.stringify(entityToForm(node)), [node]);
  useEffect(() => {
    reset(JSON.parse(snapshot) as EntityFormValues);
    setFormError(null);
  }, [snapshot, reset]);

  const submit = handleSubmit((values) => {
    setFormError(null);
    const r = parseEntityForm(node, values);
    if (!r.ok) {
      let shown = false;
      for (const [field, message] of Object.entries(r.errors)) {
        if (field === "label" || field === "description" || field === "notes" || field === "tags" || field.startsWith("metadata.")) {
          setError(field as keyof EntityFormValues, { type: "validate", message });
          shown = true;
        }
      }
      if (!shown || r.errors._form) setFormError(r.errors._form ?? "Revisa los datos de la entidad.");
      return;
    }
    editor.updateEntity(r.value);
  });

  const relations = editor.doc.edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);

  return (
    <div className="grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <ShapeIcon type={node.type} size={36} className="shrink-0" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{node.label}</h2>
          <Badge variant="secondary">{def.name}</Badge>
        </div>
      </div>

      <EntityImage graphId={graphId} node={node} onChange={(imageId) => editor.updateEntity({ ...node, imageId })} />

      <form onSubmit={submit} noValidate className="grid gap-3" aria-label={`Datos de ${node.label}`}>
        <FormError message={formError} />
        <TextField label="Nombre en el grafo" maxLength={200} error={errors.label?.message} {...register("label")} />
        <TextAreaField label="Descripción" rows={2} maxLength={2000} error={errors.description?.message} {...register("description")} />
        <TextField label="Etiquetas" maxLength={400} hint="Separadas por comas." error={errors.tags?.message} {...register("tags")} />

        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-xs font-semibold text-muted-foreground">Datos de {def.name.toLocaleLowerCase("es")}</legend>
          {def.fields.map((f) => {
            const name = `metadata.${f.key}` as const;
            const error = errors.metadata?.[f.key]?.message;
            const hint = f.sensitive ? "Dato sensible: se enmascara en listados." : undefined;
            if (f.kind === "longtext") return <TextAreaField key={f.key} label={f.label} rows={3} maxLength={f.maxLength} error={error} hint={hint} {...register(name)} />;
            if (f.kind === "select") {
              return (
                <SelectField key={f.key} label={f.label} error={error} hint={hint} {...register(name)}>
                  <option value="">Sin especificar</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectField>
              );
            }
            return <TextField key={f.key} label={f.label} maxLength={f.maxLength} type={f.kind === "url" ? "url" : "text"} autoComplete="off" error={error} hint={hint} {...register(name)} />;
          })}
        </fieldset>

        <TextAreaField label="Notas" rows={4} maxLength={8000} error={errors.notes?.message} {...register("notes")} />

        {isDirty && (
          <p role="status" className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Hay cambios sin aplicar.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!isDirty}>
            Aplicar cambios
          </Button>
          <Button type="button" variant="outline" onClick={() => onConnectFrom(node.id)}>
            <Link2 aria-hidden="true" /> Nueva relación…
          </Button>
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2 aria-hidden="true" /> Eliminar
          </Button>
        </div>
      </form>

      {graphView && <Exploration node={node} graphView={graphView} />}

      <section aria-labelledby="rel-titulo" className="grid gap-2">
        <h3 id="rel-titulo" className="text-sm font-semibold">
          Relaciones ({relations.length})
        </h3>
        {relations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Esta entidad aún no tiene relaciones.</p>
        ) : (
          <ul className="grid gap-1">
            {relations.map((e) => {
              const other = editor.nodesById.get(e.sourceId === node.id ? e.targetId : e.sourceId);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onPickEdge(e.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
                    <ArrowRight className={`size-3.5 shrink-0 ${e.sourceId === node.id ? "" : "rotate-180"}`} aria-label={e.sourceId === node.id ? "hacia" : "desde"} />
                    <span className="min-w-0 flex-1 truncate">{other?.label}{other && graphView && !graphView.result.visibleNodeIds.has(other.id) ? " (oculta)" : ""}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{e.label || RELATIONSHIP_LABELS_ES[e.relationshipType]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Imagen de la entidad: se elige un archivo, se detecta el rostro y se recorta a la forma del nodo antes de subirla. */
function EntityImage({ graphId, node, onChange }: { graphId: string; node: GraphNodeData; onChange(imageId: string | null): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const clip = useMemo(() => `polygon(${imageFrameFor(node.type).outline.map(([x, y]) => `${((x + 1) * 50).toFixed(2)}% ${((y + 1) * 50).toFixed(2)}%`).join(",")})`, [node.type]);
  const aspect = imageFrameFor(node.type).aspect;

  const choose = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ""; // permite elegir de nuevo el mismo archivo
    if (!file) return;
    try {
      validateSourceFile(file);
      setProblem(null);
      setPicked(file);
    } catch (err) {
      setProblem(err instanceof ImageSourceError ? err.message : "No se pudo usar ese archivo.");
    }
  };

  return (
    <section aria-labelledby="imagen-titulo" className="grid gap-2">
      <h3 id="imagen-titulo" className="text-sm font-semibold">
        Imagen
      </h3>
      <div className="flex items-center gap-3">
        {node.imageId ? (
          <img
            src={graphImageUrl(graphId, node.imageId)}
            alt={`Imagen de ${node.label}`}
            data-testid="entity-image-preview"
            className="shrink-0 bg-muted object-cover"
            style={{ clipPath: clip, width: aspect >= 1 ? "5rem" : `${5 * aspect}rem`, height: aspect >= 1 ? `${5 / aspect}rem` : "5rem" }}
          />
        ) : (
          <div className="grid size-20 shrink-0 place-items-center rounded-md border border-dashed text-muted-foreground" aria-hidden="true">
            <ImagePlus className="size-6" />
          </div>
        )}
        <div className="grid gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus aria-hidden="true" /> {node.imageId ? "Cambiar imagen…" : "Añadir imagen…"}
          </Button>
          {node.imageId && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Trash2 aria-hidden="true" /> Quitar imagen
            </Button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept={SOURCE_MIME_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Elegir imagen de la entidad" data-testid="entity-image-input" onChange={(e) => choose(e.target.files?.[0])} />
      {problem && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {problem}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Se recorta a la forma de la entidad y se centra en el rostro si lo hay. La detección se hace en tu navegador.</p>
      <ImageCropDialog
        file={picked}
        entityType={node.type}
        onCancel={() => setPicked(null)}
        onConfirm={async (blob) => {
          const image = await uploadGraphImage(graphId, blob);
          onChange(image.id);
          setPicked(null);
          toast.success("Imagen añadida a la entidad.");
        }}
      />
    </section>
  );
}

function RelationshipSummary({ edge, editor, onEdit, onDelete }: { edge: GraphEdgeData; editor: EditorApi; onEdit(): void; onDelete(): void }) {
  const a = editor.nodesById.get(edge.sourceId);
  const b = editor.nodesById.get(edge.targetId);
  const m = edge.metadata;
  const rows: Array<[string, string | undefined]> = [
    ["Tipo", RELATIONSHIP_LABELS_ES[edge.relationshipType]],
    ["Naturaleza", EVIDENCE_LABELS_ES[m.evidenceClass ?? "hypothesis"]],
    ["Dirección", m.direction === "none" ? "Sin dirección" : m.direction === "both" ? "En ambos sentidos" : "Del origen al destino"],
    ["Inicio", m.startDate],
    ["Fin", m.endDate],
    ["Fuente", m.source],
    ["Confianza", m.confidence === undefined ? undefined : `${m.confidence} %`],
    ["Descripción", m.description],
  ];
  return (
    <div className="grid gap-4 p-4">
      <div>
        <h2 className="text-base font-semibold">{edge.label || RELATIONSHIP_LABELS_ES[edge.relationshipType]}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{a?.label}</span>
          <ArrowRight className="size-3.5" aria-label="hacia" />
          <span className="font-medium">{b?.label}</span>
        </p>
      </div>
      <dl className="grid gap-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onEdit}>
          <Pencil aria-hidden="true" /> Editar
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden="true" /> Eliminar
        </Button>
      </div>
    </div>
  );
}

/** Recorrer el grafo desde una entidad: enfocar en ella, abrir sus vecinos ocultos o volver a cerrarlos. */
function Exploration({ node, graphView }: { node: GraphNodeData; graphView: GraphViewApi }) {
  const hidden = graphView.hiddenNeighborIds(node.id);
  const focusActive = graphView.result.focusActive;
  const canCollapse = graphView.canCollapse(node.id);
  return (
    <section aria-labelledby="explorar-titulo" className="grid gap-2">
      <h3 id="explorar-titulo" className="text-sm font-semibold">
        Explorar
      </h3>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => graphView.focusOn([node.id])}>
          <Crosshair aria-hidden="true" /> Enfocar aquí
        </Button>
        {focusActive && hidden.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => graphView.expand(node.id)}>
            <Maximize2 aria-hidden="true" /> Expandir vecinos ({hidden.length})
          </Button>
        )}
        {canCollapse && (
          <Button type="button" variant="outline" size="sm" onClick={() => graphView.collapse(node.id)}>
            <Minimize2 aria-hidden="true" /> Contraer vecinos
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {focusActive ? (hidden.length > 0 ? `${hidden.length} vecinas ocultas. También puedes expandir con doble clic en el lienzo.` : "Se ven todos sus vecinos.") : "Enfocar muestra solo esta entidad y sus vecinas; luego puedes expandir con doble clic."}
      </p>
    </section>
  );
}