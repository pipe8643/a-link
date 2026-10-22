import type { FaceDetector as MediaPipeFaceDetector } from "@mediapipe/tasks-vision";
import { type Box, scaleBox } from "./crop";

/**
 * Detección de rostros EN EL NAVEGADOR con MediaPipe BlazeFace (modelo `blaze_face_short_range`, Apache-2.0). El motor
 * WebAssembly y el modelo se sirven desde nuestro propio origen (`/mediapipe/`): la fotografía nunca sale del equipo
 * hacia un tercero. Se ejecuta en CPU (sin WebGL) para que sea igual de fiable en todos los navegadores.
 *
 * La detección es una ayuda: si no está disponible (navegador sin WebAssembly, motor no cargado, tiempo agotado…) el
 * llamador usa un recorte centrado y el usuario puede ajustarlo a mano. Nunca bloquea la subida de la imagen.
 */
export type DetectFaces = (image: HTMLImageElement) => Promise<Box[]>;

export const MEDIAPIPE_BASE = "/mediapipe";
export const FACE_MODEL_URL = `${MEDIAPIPE_BASE}/blaze_face_short_range.tflite`;
/** Lado mayor de la copia sobre la que se detecta: más grande no mejora el resultado y sí el tiempo. */
export const DETECT_MAX_SIDE = 1024;
const MIN_CONFIDENCE = 0.5;
const LOAD_TIMEOUT_MS = 20_000;

let detector: Promise<MediaPipeFaceDetector> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("La detección de rostros tardó demasiado.")), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error("Error de detección."))),
    );
  });
}

function loadDetector(): Promise<MediaPipeFaceDetector> {
  detector ??= withTimeout(
    (async () => {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE);
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_CONFIDENCE,
      });
    })(),
    LOAD_TIMEOUT_MS,
  ).catch((err: unknown) => {
    detector = null; // permite reintentar
    throw err;
  });
  return detector;
}

/** Devuelve las cajas de los rostros hallados, en píxeles de la imagen original. Lanza si el detector no está disponible. */
export const detectFaces: DetectFaces = async (image) => {
  const d = await loadDetector();
  const longSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, DETECT_MAX_SIDE / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen para detectar rostros.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = d.detect(canvas);
  const boxes: Box[] = [];
  for (const det of result.detections) {
    const b = det.boundingBox;
    if (b) boxes.push(scaleBox({ x: b.originX, y: b.originY, width: b.width, height: b.height }, 1 / scale));
  }
  return boxes;
};
