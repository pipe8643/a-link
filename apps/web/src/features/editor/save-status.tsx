import { AlertTriangle, Check, CloudOff, Loader2, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Autosave, SaveStatus } from "./use-autosave";

const LABEL: Record<SaveStatus, string> = {
  saved: "Guardado",
  dirty: "Cambios sin guardar",
  saving: "Guardando…",
  offline: "Sin conexión, reintentando…",
  error: "No se pudo guardar",
  conflict: "Conflicto de versiones",
};

const ICON: Record<SaveStatus, typeof Check> = {
  saved: Check,
  dirty: Save,
  saving: Loader2,
  offline: CloudOff,
  error: AlertTriangle,
  conflict: AlertTriangle,
};

function time(d: Date | null): string {
  return d ? d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";
}

/** Estado del guardado en la cabecera. Es una región `status` (se anuncia a lectores de pantalla). */
export function SaveStatusIndicator({ autosave, onResolveConflict }: { autosave: Autosave; onResolveConflict(): void }) {
  const { status, lastSavedAt, errorMessage } = autosave;
  const Icon = ICON[status];
  const bad = status === "error" || status === "conflict";
  return (
    <div className="flex items-center gap-1.5">
      <span
        role="status"
        aria-live="polite"
        data-save-status={status}
        title={status === "error" ? (errorMessage ?? undefined) : lastSavedAt ? `Último guardado a las ${time(lastSavedAt)}` : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
          bad ? "border-destructive/40 bg-destructive/10 text-destructive" : status === "saved" ? "text-muted-foreground" : "bg-secondary text-secondary-foreground",
        )}
      >
        <Icon aria-hidden="true" className={cn("size-3.5", status === "saving" && "animate-spin")} />
        {LABEL[status]}
      </span>
      {status === "error" && (
        <Button size="sm" variant="outline" onClick={() => void autosave.saveNow()}>
          Reintentar
        </Button>
      )}
      {status === "conflict" && (
        <Button size="sm" variant="destructive" onClick={onResolveConflict}>
          Resolver
        </Button>
      )}
      {status === "error" && errorMessage && <span className="sr-only">{errorMessage}</span>}
    </div>
  );
}

interface ConflictProps {
  open: boolean;
  onClose(): void;
  onReload(): Promise<void>;
  onOverwrite(): Promise<void>;
}

/**
 * El servidor tiene una versión más reciente (otra ventana o dispositivo guardó antes). Nada se pierde ni se
 * pisa sin decisión explícita: se puede cerrar este aviso y seguir editando en local, pero no se guardará
 * hasta resolverlo.
 */
export function ConflictDialog({ open, onClose, onReload, onOverwrite }: ConflictProps) {
  const [busy, setBusy] = useState<"reload" | "overwrite" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "reload" | "overwrite", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch {
      setError("No se pudo completar la operación. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Este grafo se modificó en otro lugar</DialogTitle>
          <DialogDescription>
            Alguien (tú, desde otra ventana o dispositivo) guardó cambios después de que abrieras este grafo. Para no perder trabajo, el
            guardado automático está en pausa. Elige cómo continuar.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          <li>
            <strong>Cargar la versión del servidor:</strong> descarta tus cambios sin guardar de esta ventana.
          </li>
          <li>
            <strong>Sobrescribir con mi versión:</strong> el contenido de esta ventana sustituye al guardado en el servidor.
          </li>
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" disabled={busy !== null} onClick={onClose}>
            Seguir sin guardar
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void run("reload", onReload)}>
            {busy === "reload" ? "Cargando…" : "Cargar la del servidor"}
          </Button>
          <Button variant="destructive" disabled={busy !== null} onClick={() => void run("overwrite", onOverwrite)}>
            {busy === "overwrite" ? "Guardando…" : "Sobrescribir con mi versión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
