import { ENTITY_CATALOG, type EntityShape, type EntityTypeId } from "@a-link/shared";
import { GLYPH_PATHS } from "./glyphs.generated";
import type { ZcNode, ZcNodeRuntime } from "./zoomcharts";

/**
 * Formas de los nodos. NetChart no ofrece triángulo ni hexágono para nodos, así que TODAS las formas
 * (círculo incluido, por coherencia) se dibujan con `display: "customShape"`. Cada una tiene:
 *   - un contorno poligonal en coordenadas unitarias (se usa para dibujar, para el área de clic y para
 *     calcular dónde se apoyan las flechas de las relaciones);
 *   - un glifo (icono del catálogo) dibujado dentro.
 * La forma nunca es el único indicador del tipo: también van el color, el icono y la leyenda.
 */
type Pt = readonly [number, number];

export interface ShapeGeometry {
  /** Semiancho/semialto respecto al radio del nodo. */
  hwFactor: number;
  hhFactor: number;
  /** Contorno cerrado en coordenadas unitarias (x, y ∈ [-1, 1]) respecto al centro del nodo. */
  outline: readonly Pt[];
  /** Centro óptico del glifo (en unitarias) y tamaño relativo. */
  glyphCenter: Pt;
  glyphScale: number;
  dashed?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Constructores de contornos
// ---------------------------------------------------------------------------------------------
const SEGMENTS = 48;

function regularPolygon(sides: number, rotation = -Math.PI / 2): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = rotation + (i * 2 * Math.PI) / sides;
    return [Math.cos(a), Math.sin(a)] as const;
  });
}

function roundedRect(corner: number, steps = 8): Pt[] {
  const pts: Pt[] = [];
  const corners: Array<[number, number, number]> = [
    [1 - corner, -1 + corner, -Math.PI / 2],
    [1 - corner, 1 - corner, 0],
    [-1 + corner, 1 - corner, Math.PI / 2],
    [-1 + corner, -1 + corner, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = start + (i * Math.PI) / 2 / steps;
      pts.push([cx + corner * Math.cos(a), cy + corner * Math.sin(a)]);
    }
  }
  return pts;
}

/** Marcador de ubicación: cabeza circular con punta hacia abajo (la punta es tangente a la cabeza). */
function pin(): Pt[] {
  const cy = -0.26;
  const r = 0.72;
  const tip = 1;
  // Ángulo (desde el centro, eje Y hacia abajo) de los puntos de tangencia con la punta.
  const tangent = Math.acos(r / (tip - cy));
  const start = Math.PI / 2 - tangent; // tangente derecha
  const sweep = 2 * Math.PI - 2 * tangent; // da la vuelta por arriba hasta la tangente izquierda
  const pts: Pt[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = start - (sweep * i) / SEGMENTS;
    pts.push([r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts.push([0, tip]);
  return pts;
}

const CIRCLE = regularPolygon(SEGMENTS, 0);

export const SHAPES: Readonly<Record<EntityShape, ShapeGeometry>> = {
  circle: { hwFactor: 1, hhFactor: 1, outline: CIRCLE, glyphCenter: [0, 0], glyphScale: 0.58 },
  square: { hwFactor: 0.9, hhFactor: 0.9, outline: roundedRect(0.2), glyphCenter: [0, 0], glyphScale: 0.62 },
  triangle: {
    hwFactor: 1.05,
    hhFactor: 1,
    outline: [
      [0, -1],
      [1, 0.8],
      [-1, 0.8],
    ],
    glyphCenter: [0, 0.22],
    glyphScale: 0.42,
  },
  hexagon: { hwFactor: 1, hhFactor: 1, outline: regularPolygon(6), glyphCenter: [0, 0], glyphScale: 0.55 },
  diamond: {
    hwFactor: 1.1,
    hhFactor: 1.1,
    outline: [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ],
    glyphCenter: [0, 0],
    glyphScale: 0.42,
  },
  rounded_rect: { hwFactor: 1.35, hhFactor: 0.9, outline: roundedRect(0.35), glyphCenter: [0, 0], glyphScale: 0.62 },
  icon_bank: {
    hwFactor: 1,
    hhFactor: 1,
    outline: [
      [0, -1],
      [1, -0.18],
      [0.8, 1],
      [-0.8, 1],
      [-1, -0.18],
    ],
    glyphCenter: [0, 0.2],
    glyphScale: 0.5,
  },
  icon_document: {
    hwFactor: 0.82,
    hhFactor: 1,
    outline: [
      [-1, -1],
      [0.35, -1],
      [1, -0.35],
      [1, 1],
      [-1, 1],
    ],
    glyphCenter: [0, 0.05],
    glyphScale: 0.52,
  },
  icon_location: { hwFactor: 0.9, hhFactor: 1, outline: pin(), glyphCenter: [0, -0.26], glyphScale: 0.45 },
  custom: { hwFactor: 1, hhFactor: 1, outline: CIRCLE, glyphCenter: [0, 0], glyphScale: 0.58, dashed: true },
};

// ---------------------------------------------------------------------------------------------
// Geometría (pura, probada en unitarias)
// ---------------------------------------------------------------------------------------------
export function pointInPolygon(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(poly: readonly Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** Distancia desde el centro (0,0) hasta el borde, en la dirección (dx, dy). El polígono debe contener el origen. */
export function rayDistance(poly: readonly Pt[], dx: number, dy: number): number {
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const ux = dx / len;
  const uy = dy / len;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    const ex = bx - ax;
    const ey = by - ay;
    const denom = ux * ey - uy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / denom; // distancia a lo largo del rayo
    const s = (ax * uy - ay * ux) / denom; // posición dentro del segmento
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

function scaled(geo: ShapeGeometry, hw: number, hh: number): Pt[] {
  return geo.outline.map(([x, y]) => [x * hw, y * hh] as const);
}

// ---------------------------------------------------------------------------------------------
// Imagen dentro de la forma
// ---------------------------------------------------------------------------------------------
/** Marco de la imagen de una entidad: el recorte debe tener la proporción de la forma y el rostro caer en `anchor`. */
export interface ImageFrame {
  /** Ancho / alto del rectángulo que contiene la forma. */
  aspect: number;
  /** Punto (unitario, respecto al centro del rectángulo) donde debe quedar el centro del rostro. */
  anchor: Pt;
  /** 0–1: parte útil del ancho que ocupa la forma (triángulo, rombo y marcador son más estrechos). */
  fit: number;
  /** Contorno en coordenadas unitarias (para dibujar la máscara en la vista previa). */
  outline: readonly Pt[];
}

export function imageFrameFor(type: EntityTypeId): ImageFrame {
  const geo = SHAPES[ENTITY_CATALOG[type].shape];
  return { aspect: geo.hwFactor / geo.hhFactor, anchor: geo.glyphCenter, fit: Math.min(1, geo.glyphScale * 1.7), outline: geo.outline };
}

/** Rectángulo (en px del lienzo, relativo al centro del nodo) donde se dibuja una imagen para CUBRIR el rectángulo `hw × hh`. */
export function coverRect(imageW: number, imageH: number, hw: number, hh: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.max((2 * hw) / imageW, (2 * hh) / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: -w / 2, y: -h / 2, w, h };
}

/** `true` si el SDK ya entregó una imagen utilizable (cargada y con tamaño). */
function isDrawable(image: unknown): image is HTMLImageElement | HTMLCanvasElement {
  if (!image) return false;
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) return image.complete && image.naturalWidth > 0;
  if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) return image.width > 0 && image.height > 0;
  return false;
}

/** Dibuja la imagen recortada a la forma (como un `cover`). Devuelve `false` si no hay imagen lista y debe pintarse el glifo. */
function paintImage(ctx: CanvasRenderingContext2D, image: unknown, poly: readonly Pt[], x: number, y: number, hw: number, hh: number): boolean {
  if (!isDrawable(image)) return false;
  const w = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const h = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const r = coverRect(w, h, hw, hh);
  ctx.save();
  tracePolygon(ctx, poly, x, y);
  ctx.clip();
  ctx.drawImage(image, x + r.x, y + r.y, r.w, r.h);
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------------------------
// Tema del lienzo (el lienzo no hereda CSS: se actualiza al cambiar claro/oscuro)
// ---------------------------------------------------------------------------------------------
export interface CanvasTheme {
  labelColor: string;
  halo: string;
  background: string;
  selection: string;
  glyph: string;
}

export const LIGHT_THEME: CanvasTheme = { labelColor: "#0f172a", halo: "#f8fafc", background: "#f8fafc", selection: "#4f46e5", glyph: "#ffffff" };
export const DARK_THEME: CanvasTheme = { labelColor: "#e2e8f0", halo: "#0b1220", background: "#0b1220", selection: "#a5b4fc", glyph: "#ffffff" };

let theme: CanvasTheme = LIGHT_THEME;
/** `true` si el tema actual de las etiquetas del lienzo es el oscuro (la exportación lo restaura al terminar). */
export const isCanvasDark = (): boolean => theme === DARK_THEME;

export function setCanvasTheme(dark: boolean): CanvasTheme {
  theme = dark ? DARK_THEME : LIGHT_THEME;
  return theme;
}

// ---------------------------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------------------------
function tracePolygon(ctx: CanvasRenderingContext2D, pts: readonly Pt[], x: number, y: number) {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px, y + py) : ctx.lineTo(x + px, y + py)));
  ctx.closePath();
}

function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, Math.max(1, lo))}…`;
}

function paintLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, hw: number, hh: number) {
  if (!text) return;
  const size = Math.max(10, Math.min(20, hw * 0.42));
  ctx.save();
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const shown = fitLabel(ctx, text, hw * 4.6);
  const ty = y + hh + size * 0.35;
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = theme.halo; // halo: legible sobre líneas y otros nodos
  ctx.strokeText(shown, x, ty);
  ctx.fillStyle = theme.labelColor;
  ctx.fillText(shown, x, ty);
  ctx.restore();
}

function paintGlyph(ctx: CanvasRenderingContext2D, icon: string | undefined, geo: ShapeGeometry, x: number, y: number, hw: number, hh: number) {
  const d = icon ? GLYPH_PATHS[icon] : undefined;
  if (!d || typeof Path2D === "undefined") return;
  const half = Math.min(hw, hh) * geo.glyphScale; // mitad del lado del glifo (24 unidades de trazo)
  const s = half / 12;
  ctx.save();
  ctx.translate(x + geo.glyphCenter[0] * hw - 12 * s, y + geo.glyphCenter[1] * hh - 12 * s);
  ctx.scale(s, s);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = theme.glyph;
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// customShape de ZoomCharts
// ---------------------------------------------------------------------------------------------
type CustomShape = NonNullable<ZoomCharts.Configuration.ItemsChartSettingsCustomShape>;
const cache = new Map<EntityTypeId, CustomShape>();

/** Devuelve (con caché por tipo) el `customShape` de ZoomCharts de un tipo de entidad. */
export function customShapeFor(type: EntityTypeId): CustomShape {
  const hit = cache.get(type);
  if (hit) return hit;

  const def = ENTITY_CATALOG[type];
  const geo = SHAPES[def.shape];
  const fill = def.defaultColor;
  const stroke = shade(fill, 0.28);

  const shape: CustomShape = {
    onUpdate(_ctx, radius) {
      const hw = radius * geo.hwFactor;
      const hh = radius * geo.hhFactor;
      return { bounds: [-hw, -hh, hw, hh], HWidth: hw, HHeight: hh };
    },

    // Los parámetros son (radio, ancho, ddx, ddy): `ddx/ddy` apuntan HACIA la forma, así que el borde
    // visto desde el centro está en la dirección contraria.
    distanceToEdge(r, w, ddx, ddy) {
      const hw = (w || r) * geo.hwFactor;
      const hh = (w || r) * geo.hhFactor;
      return rayDistance(scaled(geo, hw, hh), -ddx, -ddy);
    },

    // Devuelve 0 dentro de la forma, la distancia al borde si está dentro de la tolerancia (`prevBest`)
    // o `prevBest` si no mejora lo ya encontrado (contrato leído de la implementación del SDK).
    hitTest(this: ZcNodeRuntime, x, y, itemScale, prevBest) {
      // renderHwidth y renderHheight ya incluyen el factor de forma (los fija onUpdate).
      const hw = this.renderHwidth * itemScale;
      const hh = this.renderHheight * itemScale;
      const poly = scaled(geo, hw, hh);
      const lx = x - this.x;
      const ly = y - this.y;
      if (pointInPolygon(poly, lx, ly)) return 0;
      const d = distanceToPolygon(poly, lx, ly);
      return d < prevBest ? d : prevBest;
    },

    // OJO (medido en navegador con ZoomCharts 1.21.21): `paint` y `paintSelection` reciben el semialto en la posición
    // del semiancho y viceversa, al contrario de lo que documenta el `.d.ts` (con «Organización», hw=25,2 y hh=37,8
    // mientras `renderHwidth`=37,8). Por eso aquí los parámetros se nombran `a`/`b` y se intercambian al usarlos.
    paint(this: ZcNode, ctx, x, y, a, b, image, paintDetails) {
      const hw = b;
      const hh = a;
      const poly = scaled(geo, hw, hh);
      ctx.save();
      const alpha = typeof this.opacity === "number" ? this.opacity : 1;
      ctx.globalAlpha *= alpha;
      tracePolygon(ctx, poly, x, y);
      ctx.fillStyle = fill;
      ctx.fill();
      // Con imagen (solo al acercar lo bastante para verla) la foto sustituye al glifo; el borde se dibuja encima.
      const hasPicture = paintDetails && paintImage(ctx, image, poly, x, y, hw, hh);
      ctx.lineWidth = Math.max(1.5, hw * 0.07);
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;
      if (geo.dashed) ctx.setLineDash([hw * 0.22, hw * 0.16]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (paintDetails) {
        if (!hasPicture) paintGlyph(ctx, def.icon, geo, x, y, hw, hh);
        paintLabel(ctx, this.label ?? "", x, y, hw, hh);
      }
      ctx.restore();
    },

    // Selección: aro grueso y separado, visible sin depender del color del nodo.
    paintSelection(ctx, x, y, a, b) {
      const hw = b; // mismo intercambio que en `paint`
      const hh = a;
      const grow = 1.22;
      ctx.save();
      tracePolygon(ctx, scaled(geo, hw * grow + 3, hh * grow + 3), x, y);
      ctx.lineWidth = Math.max(3, hw * 0.1);
      ctx.lineJoin = "round";
      ctx.strokeStyle = theme.selection;
      ctx.stroke();
      ctx.restore();
    },
  };

  cache.set(type, shape);
  return shape;
}
