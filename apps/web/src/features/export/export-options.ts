import { z } from "zod";

/**
 * Opciones de exportación. Se validan con Zod aunque las genere nuestro propio formulario: el nombre de fichero y
 * los tamaños acaban en APIs del navegador (descarga, canvas) y no deben depender de que la interfaz sea correcta.
 */
export const EXPORT_FORMATS = ["png", "jpeg", "pdf", "pptx-image", "pptx-editable", "pptx-live"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
  png: "PNG (imagen, admite fondo transparente)",
  jpeg: "JPEG (imagen ligera)",
  pdf: "PDF (documento con título y leyenda)",
  "pptx-image": "PowerPoint con imagen (no editable)",
  "pptx-editable": "PowerPoint editable (formas y líneas)",
  "pptx-live": "PowerPoint interactivo (enlace de solo lectura + Web Viewer)",
};

export const FORMAT_EXTENSION: Readonly<Record<ExportFormat, string>> = {
  png: "png",
  jpeg: "jpg",
  pdf: "pdf",
  "pptx-image": "pptx",
  "pptx-editable": "pptx",
  "pptx-live": "pptx",
};

export const FORMAT_MIME: Readonly<Record<ExportFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  "pptx-image": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "pptx-editable": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "pptx-live": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ASPECTS = ["fit", "16:9", "4:3", "1:1", "a4-landscape", "a4-portrait"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const ASPECT_LABELS: Readonly<Record<Aspect, string>> = {
  fit: "Ajustada al grafo",
  "16:9": "Panorámica 16:9",
  "4:3": "Estándar 4:3",
  "1:1": "Cuadrada",
  "a4-landscape": "A4 horizontal",
  "a4-portrait": "A4 vertical",
};

export const PAGE_SIZES = ["a4", "a3", "letter"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const PAGE_LABELS: Readonly<Record<PageSize, string>> = { a4: "A4", a3: "A3", letter: "Carta" };
/** Puntos PDF (1 pt = 1/72 in), en vertical. */
export const PAGE_POINTS: Readonly<Record<PageSize, readonly [number, number]>> = { a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792] };

export const BACKGROUNDS = ["white", "dark", "transparent"] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const BACKGROUND_LABELS: Readonly<Record<Background, string>> = { white: "Blanco", dark: "Oscuro", transparent: "Transparente (solo PNG)" };

export const RESOLUTIONS = [1, 2, 3] as const;
export const RESOLUTION_LABELS: Readonly<Record<(typeof RESOLUTIONS)[number], string>> = {
  1: "Normal (1 200 px de ancho)",
  2: "Alta (2 400 px)",
  3: "Muy alta (3 600 px)",
};

/** Anchura de referencia (px CSS) del lienzo de exportación; la resolución la multiplica. */
export const BASE_WIDTH = 1200;
/** Límites del navegador para un `<canvas>`: se respeta un margen amplio por debajo del máximo real. */
export const MAX_SIDE_PX = 8192;
export const MAX_AREA_PX = 40_000_000;

const FILE_NAME_MAX = 80;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Nombre de fichero seguro (sin extensión): sin separadores de ruta, caracteres de control ni reservados de Windows,
 * y de longitud acotada. Nunca devuelve una cadena vacía.
 */
export function safeFileName(raw: string, fallback = "grafo"): string {
  const cleaned = raw
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, FILE_NAME_MAX)
    .trim();
  if (!cleaned || RESERVED_WINDOWS.test(cleaned)) return fallback;
  return cleaned;
}

export const exportOptionsSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    aspect: z.enum(ASPECTS),
    resolution: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    background: z.enum(BACKGROUNDS),
    theme: z.enum(["light", "dark"]),
    includeTitle: z.boolean(),
    includeDate: z.boolean(),
    includeLegend: z.boolean(),
    edgeLabels: z.boolean(),
    pageSize: z.enum(PAGE_SIZES),
    orientation: z.enum(["auto", "landscape", "portrait"]),
    fileName: z.string().max(200),
  })
  .strict();

export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export function defaultExportOptions(graphName: string, dark: boolean): ExportOptions {
  return {
    format: "png",
    aspect: "fit",
    resolution: 2,
    background: dark ? "dark" : "white",
    theme: dark ? "dark" : "light",
    includeTitle: true,
    includeDate: true,
    includeLegend: true,
    edgeLabels: true,
    pageSize: "a4",
    orientation: "auto",
    fileName: safeFileName(graphName),
  };
}

/**
 * Ajusta opciones incoherentes entre sí (p. ej. fondo transparente en un formato que no lo admite) en lugar de
 * fallar al exportar. El fondo y el tema de las etiquetas deben ser coherentes: texto claro sobre fondo oscuro.
 */
export function normalizeOptions(options: ExportOptions): ExportOptions {
  const o = { ...options };
  if (o.background === "transparent" && o.format !== "png") o.background = o.theme === "dark" ? "dark" : "white";
  if (o.background === "dark") o.theme = "dark";
  else if (o.background === "white") o.theme = "light";
  return o;
}

export interface OutputSize {
  /** Tamaño del lienzo de exportación en px CSS. */
  width: number;
  height: number;
  /** Factor de escala aplicado por ZoomCharts: los píxeles finales son width·scale × height·scale. */
  scale: number;
  /** Píxeles finales. */
  pixelWidth: number;
  pixelHeight: number;
  /** `true` si se redujo la resolución pedida para respetar los límites del navegador. */
  reduced: boolean;
}

const ASPECT_RATIO: Readonly<Record<Exclude<Aspect, "fit">, number>> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "a4-landscape": 297 / 210,
  "a4-portrait": 210 / 297,
};

/**
 * Calcula el tamaño de salida. `contentAspect` es la proporción (ancho/alto) del grafo con sus márgenes; solo se
 * usa con `fit`. Con un grafo extremadamente alargado la proporción se acota (0,25–4) para no producir imágenes
 * inservibles. Nunca se superan los límites de canvas del navegador: si hace falta, se baja la resolución.
 */
export function computeOutputSize(aspect: Aspect, resolution: 1 | 2 | 3, contentAspect = 1.5, baseWidth = BASE_WIDTH): OutputSize {
  const ratio = aspect === "fit" ? Math.min(4, Math.max(0.25, Number.isFinite(contentAspect) && contentAspect > 0 ? contentAspect : 1.5)) : ASPECT_RATIO[aspect];
  return sizeForRatio(ratio, resolution, baseWidth);
}

/** Tamaño de salida para una proporción ancho/alto concreta (p. ej. el hueco de una página PDF). */
export function sizeForRatio(ratio: number, resolution: 1 | 2 | 3, baseWidth = BASE_WIDTH): OutputSize {
  // Los formatos verticales se calculan sobre la altura equivalente para no quedarse pequeños.
  const width = ratio >= 1 ? baseWidth : Math.round(baseWidth * ratio);
  const height = ratio >= 1 ? Math.round(baseWidth / ratio) : baseWidth;

  let scale: number = resolution;
  while (scale > 1 && (width * scale > MAX_SIDE_PX || height * scale > MAX_SIDE_PX || width * height * scale * scale > MAX_AREA_PX)) scale -= 1;
  return { width, height, scale, pixelWidth: width * scale, pixelHeight: height * scale, reduced: scale !== resolution };
}
