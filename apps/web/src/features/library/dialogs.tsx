import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { applyServerErrors, describeError } from "@/lib/form-errors";
import { folderOptions, subtreeIds } from "@/lib/folder-tree";
import { type FolderValues, type GraphValues, folderSchema, graphSchema } from "@/lib/schemas";
import type { Folder, FolderDeleteMode, GraphSummary } from "@/lib/types";
import {
  useCreateFolder,
  useCreateGraph,
  useDeleteFolder,
  useUpdateFolder,
  useUpdateGraph,
} from "./queries";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ------------------------------------------------------------------ confirmación genérica

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: BaseProps & {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            loading={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (err) {
                setError(describeError(err));
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ carpetas

export type FolderDialogMode = { type: "create"; parentId: string | null } | { type: "rename"; folder: Folder };

export function FolderDialog({ open, onOpenChange, mode }: BaseProps & { mode: FolderDialogMode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <FolderForm mode={mode} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function FolderForm({ mode, onDone }: { mode: FolderDialogMode; onDone: () => void }) {
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FolderValues>({
    resolver: zodResolver(folderSchema),
    defaultValues: { name: mode.type === "rename" ? mode.folder.name : "" },
  });
  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (mode.type === "create") {
        await create.mutateAsync({ name: values.name, parentId: mode.parentId });
        toast.success("Carpeta creada");
      } else {
        await update.mutateAsync({ id: mode.folder.id, name: values.name });
        toast.success("Carpeta renombrada");
      }
      onDone();
    } catch (err) {
      setServerError(applyServerErrors<FolderValues>(err, setError, ["name"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{mode.type === "create" ? (mode.parentId ? "Nueva subcarpeta" : "Nueva carpeta") : "Renombrar carpeta"}</DialogTitle>
        <DialogDescription>Las carpetas te ayudan a agrupar grafos por caso o tema.</DialogDescription>
      </DialogHeader>
      <FormError message={serverError} />
      <TextField label="Nombre" autoFocus maxLength={200} error={errors.name?.message} {...register("name")} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {mode.type === "create" ? "Crear" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function MoveFolderDialog({ open, onOpenChange, folder, folders }: BaseProps & { folder: Folder; folders: Folder[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <MoveFolderForm folder={folder} folders={folders} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function MoveFolderForm({ folder, folders, onDone }: { folder: Folder; folders: Folder[]; onDone: () => void }) {
  const update = useUpdateFolder();
  const [target, setTarget] = useState(folder.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const options = folderOptions(folders, subtreeIds(folders, folder.id));

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await update.mutateAsync({ id: folder.id, parentId: target || null });
          toast.success("Carpeta movida");
          onDone();
        } catch (err) {
          setError(describeError(err));
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Mover «{folder.name}»</DialogTitle>
        <DialogDescription>No se puede mover una carpeta dentro de sí misma ni de sus subcarpetas.</DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <SelectField label="Carpeta de destino" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Raíz (sin carpeta padre)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={update.isPending}>
          Cancelar
        </Button>
        <Button type="submit" loading={update.isPending}>
          Mover
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folder,
  folders,
  onDeleted,
}: BaseProps & { folder: Folder; folders: Folder[]; onDeleted: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <DeleteFolderForm folder={folder} folders={folders} onDone={() => onOpenChange(false)} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteFolderForm({
  folder,
  folders,
  onDone,
  onDeleted,
}: {
  folder: Folder;
  folders: Folder[];
  onDone: () => void;
  onDeleted: () => void;
}) {
  const del = useDeleteFolder();
  const [mode, setMode] = useState<FolderDeleteMode>("move_to_parent");
  const [error, setError] = useState<string | null>(null);
  const ids = subtreeIds(folders, folder.id);
  const subfolders = ids.size - 1;
  const graphsHere = folders.filter((f) => ids.has(f.id)).reduce((n, f) => n + (f.graphCount ?? 0), 0);
  const parentLabel = folder.parentId ? "la carpeta padre" : "la raíz";

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await del.mutateAsync({ id: folder.id, contents: mode });
          toast.success("Carpeta eliminada");
          onDeleted();
          onDone();
        } catch (err) {
          setError(describeError(err));
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Eliminar «{folder.name}»</DialogTitle>
        <DialogDescription>
          Contiene {subfolders} {subfolders === 1 ? "subcarpeta" : "subcarpetas"} y {graphsHere} {graphsHere === 1 ? "grafo activo" : "grafos activos"}.
          Elige qué hacer con su contenido.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <fieldset className="grid gap-2">
        <legend className="sr-only">Contenido de la carpeta</legend>
        <ModeOption
          checked={mode === "move_to_parent"}
          onChange={() => setMode("move_to_parent")}
          title={`Conservar el contenido en ${parentLabel}`}
          text="Las subcarpetas y los grafos suben un nivel. No se pierde nada."
        />
        <ModeOption
          checked={mode === "trash"}
          onChange={() => setMode("trash")}
          title="Enviar los grafos a la papelera"
          text="Se eliminan la carpeta y sus subcarpetas; los grafos se pueden restaurar desde la papelera."
        />
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={del.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" loading={del.isPending}>
          Eliminar carpeta
        </Button>
      </DialogFooter>
    </form>
  );
}

function ModeOption({ checked, onChange, title, text }: { checked: boolean; onChange: () => void; title: string; text: string }) {
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/50">
      <input type="radio" name="folder-delete-mode" checked={checked} onChange={onChange} className="mt-0.5 accent-[var(--primary)]" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs font-normal text-muted-foreground">{text}</span>
      </span>
    </Label>
  );
}

// ------------------------------------------------------------------ grafos

export type GraphDialogMode = { type: "create"; folderId: string | null } | { type: "edit"; graph: GraphSummary };

export function GraphDialog({
  open,
  onOpenChange,
  mode,
  folders,
  onCreated,
}: BaseProps & { mode: GraphDialogMode; folders: Folder[]; onCreated?: (graph: GraphSummary) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <GraphForm mode={mode} folders={folders} onDone={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function GraphForm({
  mode,
  folders,
  onDone,
  onCreated,
}: {
  mode: GraphDialogMode;
  folders: Folder[];
  onDone: () => void;
  onCreated?: (graph: GraphSummary) => void;
}) {
  const create = useCreateGraph();
  const update = useUpdateGraph();
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = mode.type === "edit";
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<GraphValues>({
    resolver: zodResolver(graphSchema),
    defaultValues: {
      name: editing ? mode.graph.name : "",
      description: editing ? mode.graph.description : "",
      folderId: (editing ? mode.graph.folderId : mode.folderId) ?? "",
    },
  });
  const pending = create.isPending || update.isPending;
  const options = folderOptions(folders);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const folderId = values.folderId || null;
    try {
      if (mode.type === "create") {
        const { graph } = await create.mutateAsync({ name: values.name, description: values.description, folderId });
        toast.success("Grafo creado");
        onCreated?.(graph);
      } else {
        await update.mutateAsync({ id: mode.graph.id, name: values.name, description: values.description, folderId });
        toast.success("Cambios guardados");
      }
      onDone();
    } catch (err) {
      setServerError(applyServerErrors<GraphValues>(err, setError, ["name", "description", "folderId"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Editar grafo" : "Nuevo grafo"}</DialogTitle>
        <DialogDescription>
          {editing ? "Cambia el nombre, la descripción o la carpeta." : "Podrás añadir personas, vehículos, teléfonos y sus relaciones en el editor."}
        </DialogDescription>
      </DialogHeader>
      <FormError message={serverError} />
      <TextField label="Nombre" autoFocus maxLength={200} error={errors.name?.message} {...register("name")} />
      <TextAreaField
        label="Descripción (opcional)"
        rows={3}
        maxLength={2000}
        error={errors.description?.message}
        {...register("description")}
      />
      <SelectField label="Carpeta" error={errors.folderId?.message} {...register("folderId")}>
        <option value="">Sin carpeta</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {editing ? "Guardar" : "Crear grafo"}
        </Button>
      </DialogFooter>
    </form>
  );
}