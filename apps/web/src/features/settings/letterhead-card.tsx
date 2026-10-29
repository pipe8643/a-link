import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { prepareLetterhead } from "@/branding/prepare-letterhead";
import { FormError } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageSourceError, SOURCE_MIME_TYPES } from "@/features/images/image-output";
import { api, apiBlob, isApiError } from "@/lib/api";
import { describeError } from "@/lib/form-errors";

export function LetterheadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiBlob("/users/me/letterhead", { signal: controller.signal })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        previewUrl.current = url;
        setPreview(url);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (isApiError(err) && err.status === 404) {
          setPreview(null);
          return;
        }
        setError(describeError(err));
      });
    return () => {
      controller.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  const show = (blob: Blob) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = URL.createObjectURL(blob);
    previewUrl.current = url;
    setPreview(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await prepareLetterhead(file);
      await api("/users/me/letterhead", { method: "PUT", binary: { data: blob, contentType: blob.type } });
      show(blob);
      toast.success("Fondo actualizado");
    } catch (err) {
      setError(err instanceof ImageSourceError ? err.message : describeError(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const restore = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api("/users/me/letterhead", { method: "DELETE" });
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
      setPreview(null);
      toast.success("Se quitó la imagen de fondo");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fondo del visor</CardTitle>
        <CardDescription>
          Imagen de membrete del visor HTML compartido y de las diapositivas PowerPoint. Si no eliges ninguna, el visor
          queda en blanco.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        <div className="overflow-hidden rounded-md border bg-white">
          {preview ? (
            <img src={preview} alt="Vista previa del fondo" className="aspect-video w-full object-contain" />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-slate-500">Sin imagen de fondo</div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={SOURCE_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Elegir imagen de fondo"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" loading={busy} onClick={() => inputRef.current?.click()}>
            Elegir imagen
          </Button>
          <Button type="button" variant="outline" loading={busy} disabled={!preview} onClick={() => void restore()}>
            Quitar imagen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
