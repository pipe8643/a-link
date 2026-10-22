import { type EntityTypeId, ENTITY_CATALOG } from "@a-link/shared";
import { Crosshair, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormError } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api";
import { describeError } from "@/lib/form-errors";
import { imageFrameFor } from "../editor/shapes";
import {
  type CropState,
  MAX_ZOOM,
  MIN_ZOOM,
  type Size,
  centeredCrop,
  cropForFace,
  cropRect,
  outputSize,
  panCrop,
  pickMainFace,
  zoomCrop,
  type Box,
} from "./crop";
import { type DetectFaces, detectFaces } from "./face-detector";
import { ImageSourceError, buildEntityImage, loadImageFile, sizeOf } from "./image-output";

const VIEW_SIDE = 280;
const KEY_STEP = 12;

interface Props {
  /** Archivo elegido; `null` mantiene el diálogo cerrado. */
  file: File | null;
  entityType: EntityTypeId;
  onCancel(): void;
  /** Recibe la imagen final ya recortada. Si lanza, el diálogo sigue abierto y muestra el error. */
  onConfirm(image: Blob): Promise<void>;
  /** Detector de rostros (inyectable en pruebas). */
  detect?: DetectFaces;
}

/** Mensaje para el usuario: errores de la imagen y de la API ya vienen en español; el resto, uno genérico. */
const errorText = (err: unknown, fallback: string): string => (err instanceof ImageSourceError ? err.message : isApiError(err) ? describeError(err) : fallback);

type Phase = "loading" | "detecting" | "ready" | "failed";

export function ImageCropDialog({ file, onCancel, ...rest }: Props) {
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md" aria-describedby="crop-desc">
        {file ? <CropForm file={file} onCancel={onCancel} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CropForm({ file, entityType, onCancel, onConfirm, detect = detectFaces }: Props & { file: File }) {
  const frame = useMemo(() => imageFrameFor(entityType), [entityType]);
  const view = useMemo(() => outputSize(frame.aspect, VIEW_SIDE), [frame.aspect]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [face, setFace] = useState<Box | null>(null);
  const [message, setMessage] = useState("Cargando la imagen…");
  const [crop, setCrop] = useState<CropState>({ cx: 0, cy: 0, zoom: MIN_ZOOM });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const src: Size | null = img ? sizeOf(img) : null;

  // Carga, detección y recorte inicial. Si algo falla, el recorte centrado sigue siendo utilizable (salvo que la imagen sea inválida).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: HTMLImageElement;
      try {
        loaded = await loadImageFile(file);
      } catch (err) {
        if (cancelled) return;
        setError(errorText(err, "No se pudo leer la imagen."));
        setPhase("failed");
        return;
      }
      if (cancelled) return;
      const size = sizeOf(loaded);
      setImg(loaded);
      setCrop(centeredCrop(size, frame.aspect));
      setPhase("detecting");
      setMessage("Buscando rostro…");
      try {
        const { face: main, count } = pickMainFace(await detect(loaded));
        if (cancelled) return;
        if (main) {
          setFace(main);
          setCrop(cropForFace(size, main, frame));
          setMessage(count > 1 ? `Se detectaron ${count} rostros; se centró el más grande. Puedes ajustar el recorte.` : "Rostro detectado y centrado. Puedes ajustar el recorte.");
        } else {
          setMessage("No se detectó ningún rostro. Se centró la imagen: ajusta el recorte a mano.");
        }
      } catch {
        if (cancelled) return;
        setMessage("La detección automática de rostros no está disponible. Ajusta el recorte a mano.");
      }
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [file, frame, detect]);

  // Vista previa: la zona recortada, atenuada fuera de la forma del nodo (lo que queda fuera no se verá en el lienzo).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !img || !src) return;
    const r = cropRect(src, frame.aspect, crop);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, view.width, view.height);
    const path = new Path2D();
    path.rect(0, 0, view.width, view.height);
    frame.outline.forEach(([ux, uy], i) => {
      const px = (ux + 1) * (view.width / 2);
      const py = (uy + 1) * (view.height / 2);
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    });
    path.closePath();
    ctx.fillStyle = "rgba(15, 23, 42, 0.62)";
    ctx.fill(path, "evenodd");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    const outline = new Path2D();
    frame.outline.forEach(([ux, uy], i) => {
      const px = (ux + 1) * (view.width / 2);
      const py = (uy + 1) * (view.height / 2);
      if (i === 0) outline.moveTo(px, py);
      else outline.lineTo(px, py);
    });
    outline.closePath();
    ctx.stroke(outline);
  }, [img, src, crop, frame, view.width, view.height]);

  const move = useCallback((dx: number, dy: number) => src && setCrop((c) => panCrop(src, frame.aspect, c, dx, dy, view.width)), [src, frame.aspect, view.width]);
  const ready = phase === "ready" && img !== null && src !== null;

  const confirm = async () => {
    if (!img || !src || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await buildEntityImage(img, cropRect(src, frame.aspect, crop), frame.aspect);
      await onConfirm(blob);
    } catch (err) {
      setError(errorText(err, "No se pudo guardar la imagen."));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Recortar imagen de {ENTITY_CATALOG[entityType].name.toLocaleLowerCase("es")}</DialogTitle>
        <DialogDescription id="crop-desc">
          La imagen se adapta a la forma de la entidad. Arrastra para moverla y usa la ampliación para encuadrarla; la parte atenuada no se verá. Todo se procesa en tu equipo.
        </DialogDescription>
      </DialogHeader>

      <FormError message={error} />

      {phase !== "failed" && (
        <div className="grid justify-items-center gap-3">
          <canvas
            ref={canvasRef}
            width={view.width}
            height={view.height}
            tabIndex={ready ? 0 : -1}
            data-testid="crop-preview"
            role="img"
            aria-label="Vista previa del recorte. Arrastra para mover la imagen; con el teclado, las flechas la mueven y más o menos cambian la ampliación."
            className="touch-none rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            style={{ width: view.width, height: view.height, cursor: ready ? "grab" : "progress", maxWidth: "100%" }}
            onPointerDown={(e) => {
              if (!ready) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d || d.id !== e.pointerId) return;
              // La vista puede estar escalada por CSS (`maxWidth`): se convierten los píxeles de pantalla a los del lienzo.
              const k = view.width / e.currentTarget.getBoundingClientRect().width;
              move((e.clientX - d.x) * k, (e.clientY - d.y) * k);
              dragRef.current = { id: d.id, x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
            onKeyDown={(e) => {
              if (!ready || !src) return;
              const arrows: Record<string, [number, number]> = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] };
              const a = arrows[e.key];
              if (a) {
                e.preventDefault();
                move(a[0], a[1]);
              } else if (e.key === "+" || e.key === "=" || e.key === "-") {
                e.preventDefault();
                setCrop((c) => zoomCrop(src, frame.aspect, c, c.zoom * (e.key === "-" ? 1 / 1.15 : 1.15)));
              }
            }}
          />
          <p role="status" className="min-h-10 text-center text-sm text-muted-foreground" data-testid="crop-message">
            {message}
          </p>
          <div className="grid w-full gap-1.5">
            <label htmlFor="crop-zoom" className="text-sm font-medium">
              Ampliación
            </label>
            <input
              id="crop-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={crop.zoom}
              disabled={!ready}
              onChange={(e) => src && setCrop((c) => zoomCrop(src, frame.aspect, c, Number(e.target.value)))}
              className="w-full accent-primary"
            />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!ready || !face} onClick={() => src && face && setCrop(cropForFace(src, face, frame))}>
              <Crosshair aria-hidden="true" /> Centrar en el rostro
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => src && setCrop(centeredCrop(src, frame.aspect))}>
              <RotateCcw aria-hidden="true" /> Restablecer
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="button" onClick={() => void confirm()} disabled={!ready} loading={busy}>
          Usar imagen
        </Button>
      </DialogFooter>
    </>
  );
}
