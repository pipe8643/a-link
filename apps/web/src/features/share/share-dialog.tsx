import { Copy, Loader2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormError, SelectField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, pluralize } from "@/lib/format";
import { describeError } from "@/lib/form-errors";
import { type ShareLink, useCreateShare, useRevokeShare, useShares } from "./queries";
import { SHARE_DAYS, SHARE_DAYS_LABELS, SHARE_STATUS_LABELS, type ShareDays, buildShareUrl, copyShareUrl } from "./share-link";

interface Props {
  open: boolean;
  onClose(): void;
  graphId: string;
}

/** Diálogo para crear, copiar y revocar enlaces de solo lectura (el token solo se muestra al crearlos). */
export function ShareDialog({ open, onClose, graphId }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">{open ? <ShareForm graphId={graphId} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function ShareForm({ graphId, onClose }: { graphId: string; onClose(): void }) {
  const list = useShares(graphId, true);
  const create = useCreateShare(graphId);
  const revoke = useRevokeShare(graphId);
  const [days, setDays] = useState<ShareDays>(7);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => setFreshUrl(null), []);

  const onCreate = async () => {
    setError(null);
    try {
      const { token } = await create.mutateAsync(days);
      const url = buildShareUrl(window.location.origin, token);
      setFreshUrl(url);
      if (await copyShareUrl(url)) toast.success("Enlace copiado. Guárdalo: no se volverá a mostrar.");
      else toast.success("Enlace creado. Cópialo ahora: no se volverá a mostrar.");
    } catch (err) {
      setError(describeError(err));
    }
  };

  const onCopy = async () => {
    if (!freshUrl) return;
    if (await copyShareUrl(freshUrl)) toast.success("Enlace copiado.");
  };

  const onRevoke = async (share: ShareLink) => {
    setError(null);
    try {
      await revoke.mutateAsync(share.id);
      toast.success("Enlace revocado: quien lo tenía ya no puede abrir el grafo.");
    } catch (err) {
      setError(describeError(err));
    }
  };

  const items = list.data ?? [];
  const active = items.filter((s) => s.status === "active");

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Compartir grafo</DialogTitle>
        <DialogDescription>
          Quien tenga el enlace ve el grafo <strong>tal como está guardado ahora</strong> (no una foto congelada), sin notas ni
          campos sensibles. Hace falta que A-Link sea alcanzable por HTTPS. El enlace siempre caduca; puedes revocarlo antes.
        </DialogDescription>
      </DialogHeader>

      {freshUrl && (
        <div className="grid gap-2 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">Este enlace no se volverá a mostrar</p>
          <div className="flex gap-2">
            <input readOnly value={freshUrl} aria-label="Enlace de solo lectura" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}>
              <Copy aria-hidden="true" /> Copiar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <SelectField label="Caduca en" value={String(days)} onChange={(e) => setDays(Number(e.target.value) as ShareDays)} wrapperClassName="min-w-40 flex-1">
          {SHARE_DAYS.map((d) => (
            <option key={d} value={d}>
              {SHARE_DAYS_LABELS[d]}
            </option>
          ))}
        </SelectField>
        <Button type="button" onClick={() => void onCreate()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Share2 aria-hidden="true" />}
          Crear enlace
        </Button>
      </div>

      <section aria-labelledby="enlaces-titulo" className="grid gap-2">
        <h3 id="enlaces-titulo" className="text-sm font-semibold">
          Enlaces de este grafo
        </h3>
        {list.isPending && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {list.isError && (
          <p role="alert" className="text-sm text-destructive">
            No se pudieron cargar los enlaces.
          </p>
        )}
        {list.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay enlaces. Crea uno para verlo en solo lectura o incrustarlo en PowerPoint.</p>}
        {items.length > 0 && (
          <ul className="grid gap-2">
            {items.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Badge variant={s.status === "active" ? "secondary" : "outline"}>{SHARE_STATUS_LABELS[s.status]}</Badge>
                <div className="min-w-0 flex-1">
                  <p>Caduca el {formatDateTime(s.expiresAt)}</p>
                  <p className="text-xs text-muted-foreground">{pluralize(s.viewCount, "vista", "vistas")}</p>
                </div>
                {s.status === "active" && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void onRevoke(s)} disabled={revoke.isPending}>
                    Revocar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {active.length >= 10 && <p className="text-xs text-muted-foreground">Este grafo ya tiene el máximo de enlaces activos. Revoca alguno para crear otro.</p>}
      </section>

      <FormError message={error} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </DialogFooter>
    </div>
  );
}
