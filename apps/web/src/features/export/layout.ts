import type { GraphNodeData, GraphSnapshot } from "@a-link/shared";
import { NODE_RADIUS } from "../editor/zoom-data";

export interface Point {
  x: number;
  y: number;
}

export type Positions = ReadonlyMap<string, Point>;

const GRID_SPACING = 160;

/**
 * Cuadrícula determinista para las entidades que no tienen posición: ordenadas por tipo y nombre, así dos
 * exportaciones del mismo grafo salen igual. Se coloca a partir de `origin`.
 */
export function gridLayout(nodes: readonly GraphNodeData[], origin: Point = { x: 0, y: 0 }): Map<string, Point> {
  const sorted = [...nodes].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label, "es") || a.id.localeCompare(b.id));
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const out = new Map<string, Point>();
  sorted.forEach((n, i) => out.set(n.id, { x: origin.x + (i % cols) * GRID_SPACING, y: origin.y + Math.floor(i / cols) * GRID_SPACING }));
  return out;
}

/**
 * Posición de cada entidad para exportar. Prioridad: la que muestra el lienzo ahora (`live`) > la guardada en el
 * documento > una cuadrícula determinista (para las que nunca se colocaron). Todas son finitas: nada de NaN.
 */
export function resolvePositions(doc: GraphSnapshot, live?: Positions | null): Map<string, Point> {
  const out = new Map<string, Point>();
  const missing: GraphNodeData[] = [];
  for (const n of doc.nodes) {
    const l = live?.get(n.id);
    if (l && Number.isFinite(l.x) && Number.isFinite(l.y)) out.set(n.id, { x: l.x, y: l.y });
    else if (n.positionX !== null && n.positionY !== null && Number.isFinite(n.positionX) && Number.isFinite(n.positionY)) out.set(n.id, { x: n.positionX, y: n.positionY });
    else missing.push(n);
  }
  if (missing.length > 0) {
    // Debajo de lo ya colocado, para no solapar.
    const b = boundsOf(out);
    const origin = out.size === 0 ? { x: 0, y: 0 } : { x: b.minX, y: b.maxY + GRID_SPACING };
    for (const [id, p] of gridLayout(missing, origin)) out.set(id, p);
  }
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function boundsOf(positions: Positions, margin = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Proporción ancho/alto del grafo con el margen de las formas y etiquetas (para el modo «ajustada al grafo»). */
export function contentAspect(positions: Positions): number {
  const b = boundsOf(positions, NODE_RADIUS * 2.2);
  return b.height > 0 ? b.width / b.height : 1.5;
}

/** Copia del documento con las posiciones resueltas (el original no se modifica). */
export function withPositions(doc: GraphSnapshot, positions: Positions): GraphSnapshot {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const p = positions.get(n.id);
      return p ? { ...n, positionX: p.x, positionY: p.y } : n;
    }),
  };
}
