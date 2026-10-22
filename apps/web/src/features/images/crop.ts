/**
 * Recorte de la imagen de una entidad. Todo son funciones puras (sin DOM): la imagen original se mide en píxeles
 * de origen y el recorte tiene SIEMPRE la proporción de la forma del nodo (`aspect` = ancho / alto).
 *
 * El estado del recorte es `{ cx, cy, zoom }`: centro en píxeles de origen y ampliación (1 = el mayor recorte posible
 * con esa proporción; a más zoom, menos zona de la imagen). Cualquier estado se «sujeta» para que el rectángulo
 * quede dentro de la imagen: no se pueden introducir bandas vacías.
 */
export interface Size {
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropState {
  cx: number;
  cy: number;
  zoom: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Parte del ancho del recorte que debe ocupar el rostro cuando la forma lo permite (el resto es hombros, pelo y margen). */
export const FACE_FRACTION = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Ancho del mayor recorte de proporción `aspect` que cabe en la imagen. */
export function baseWidth(src: Size, aspect: number): number {
  return Math.min(src.width, src.height * aspect);
}

/** Rectángulo de recorte (en px de origen) de un estado, siempre dentro de la imagen. */
export function cropRect(src: Size, aspect: number, state: CropState): Box {
  const zoom = clamp(Number.isFinite(state.zoom) ? state.zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const width = baseWidth(src, aspect) / zoom;
  const height = width / aspect;
  const cx = clamp(Number.isFinite(state.cx) ? state.cx : src.width / 2, width / 2, src.width - width / 2);
  const cy = clamp(Number.isFinite(state.cy) ? state.cy : src.height / 2, height / 2, src.height - height / 2);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** Devuelve el mismo estado con zoom y centro dentro de los límites válidos. */
export function clampState(src: Size, aspect: number, state: CropState): CropState {
  const r = cropRect(src, aspect, state);
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, zoom: clamp(Number.isFinite(state.zoom) ? state.zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM) };
}

/** Recorte centrado sin ampliar: la mayor zona de la imagen con la proporción de la forma. */
export function centeredCrop(src: Size, aspect: number): CropState {
  return clampState(src, aspect, { cx: src.width / 2, cy: src.height / 2, zoom: MIN_ZOOM });
}

export interface FaceFrame {
  aspect: number;
  /** Punto unitario del rectángulo (−1..1) donde debe caer el centro del rostro. */
  anchor: readonly [number, number];
  /** Parte útil del ancho que ocupa la forma (0–1). */
  fit: number;
}

/**
 * Recorte que deja el rostro visible y bien situado dentro de la forma: el rostro ocupa `FACE_FRACTION × fit` del ancho
 * y su centro cae en el ancla de la forma. Si la foto es demasiado ajustada (el rostro ya llena la imagen) el recorte se
 * sujeta a la imagen: el rostro se ve entero igualmente porque nunca se recorta más de lo que mide.
 */
export function cropForFace(src: Size, face: Box, frame: FaceFrame): CropState {
  const faceSize = Math.max(face.width, face.height);
  const wanted = faceSize / (FACE_FRACTION * clamp(frame.fit, 0.3, 1));
  const zoom = clamp(baseWidth(src, frame.aspect) / Math.max(1, wanted), MIN_ZOOM, MAX_ZOOM);
  const width = baseWidth(src, frame.aspect) / zoom;
  const height = width / frame.aspect;
  const fx = face.x + face.width / 2;
  const fy = face.y + face.height / 2;
  return clampState(src, frame.aspect, { cx: fx - (frame.anchor[0] * width) / 2, cy: fy - (frame.anchor[1] * height) / 2, zoom });
}

/** Mueve el recorte al arrastrar la imagen `dx, dy` píxeles de pantalla en una vista de `viewWidth` px de ancho. */
export function panCrop(src: Size, aspect: number, state: CropState, dx: number, dy: number, viewWidth: number): CropState {
  const rect = cropRect(src, aspect, state);
  const k = rect.width / Math.max(1, viewWidth); // px de origen por px de pantalla
  return clampState(src, aspect, { ...state, cx: rect.x + rect.width / 2 - dx * k, cy: rect.y + rect.height / 2 - dy * k });
}

/** Cambia el zoom conservando el centro (y sujetándolo si el nuevo recorte se saldría de la imagen). */
export function zoomCrop(src: Size, aspect: number, state: CropState, zoom: number): CropState {
  const rect = cropRect(src, aspect, state);
  return clampState(src, aspect, { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, zoom });
}

/** Dimensiones de la imagen final: el lado mayor mide `side` y se mantiene la proporción de la forma. */
export function outputSize(aspect: number, side: number): Size {
  return aspect >= 1 ? { width: side, height: Math.max(1, Math.round(side / aspect)) } : { width: Math.max(1, Math.round(side * aspect)), height: side };
}

/** Elige el rostro principal (el de mayor área) y cuenta cuántos hay. Ignora cajas vacías o no finitas. */
export function pickMainFace(faces: readonly Box[]): { face: Box | null; count: number } {
  const valid = faces.filter((f) => [f.x, f.y, f.width, f.height].every(Number.isFinite) && f.width > 0 && f.height > 0);
  if (valid.length === 0) return { face: null, count: 0 };
  const face = valid.reduce((best, f) => (f.width * f.height > best.width * best.height ? f : best));
  return { face, count: valid.length };
}

/** Escala una caja (p. ej. detectada sobre una copia reducida) a las dimensiones originales. */
export function scaleBox(box: Box, factor: number): Box {
  return { x: box.x * factor, y: box.y * factor, width: box.width * factor, height: box.height * factor };
}
