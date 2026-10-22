import { ENTITY_CATALOG, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";

/**
 * Halos («auras» de ZoomCharts): un contorno de color que agrupa visualmente entidades aunque no estén
 * relacionadas entre sí. Solo presentación: no cambian los datos.
 *  - `type`: una por tipo de entidad (con el color del tipo).
 *  - `tag`: una por la PRIMERA etiqueta de la entidad (las entidades sin etiquetas no tienen halo).
 */
export type AuraMode = "none" | "type" | "tag";

export const AURA_MODES: readonly AuraMode[] = ["none", "type", "tag"];
export const AURA_MODE_LABELS: Readonly<Record<AuraMode, string>> = {
  none: "Sin halos",
  type: "Halos por tipo",
  tag: "Halos por etiqueta",
};

/** Colores con buen contraste sobre fondo claro y oscuro; se asignan a las etiquetas por un hash estable. */
export const AURA_PALETTE: readonly string[] = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

const normalizeTag = (tag: string) => tag.trim().toLocaleLowerCase("es");

/** Hash FNV-1a: estable entre sesiones y sin depender del resto de etiquetas (el color no «salta» al filtrar). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const colorForTag = (tag: string): string => AURA_PALETTE[hash(normalizeTag(tag)) % AURA_PALETTE.length]!;

/** Identificador del halo de una entidad (o `undefined` si no tiene). */
export function auraIdOf(node: Pick<GraphNodeData, "type" | "tags">, mode: AuraMode): string | undefined {
  if (mode === "type") return `type:${node.type}`;
  if (mode === "tag") {
    const first = node.tags.map(normalizeTag).find((t) => t !== "");
    return first ? `tag:${first}` : undefined;
  }
  return undefined;
}

export interface AuraGroup {
  id: string;
  label: string;
  color: string;
  count: number;
}

/** Halos presentes en el documento, para la leyenda del panel y para los estilos del lienzo. */
export function auraGroups(doc: GraphSnapshot, mode: AuraMode): AuraGroup[] {
  if (mode === "none") return [];
  const groups = new Map<string, AuraGroup>();
  for (const n of doc.nodes) {
    const id = auraIdOf(n, mode);
    if (!id) continue;
    const g = groups.get(id);
    if (g) g.count += 1;
    else if (mode === "type") groups.set(id, { id, label: ENTITY_CATALOG[n.type].name, color: ENTITY_CATALOG[n.type].defaultColor, count: 1 });
    else {
      const tag = n.tags.find((t) => normalizeTag(t) !== "")!.trim();
      groups.set(id, { id, label: tag, color: colorForTag(tag), count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(100,116,139,${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}

/** Ajustes `auras` de NetChart. Con `defaultColors: []` solo se dibujan los halos definidos aquí. */
export function auraSettings(doc: GraphSnapshot, mode: AuraMode) {
  if (mode === "none") return { enabled: false };
  const style: Record<string, { fillColor: string; lineColor: string; lineWidth: number; showInLegend: boolean }> = {};
  for (const g of auraGroups(doc, mode)) style[g.id] = { fillColor: rgba(g.color, 0.16), lineColor: rgba(g.color, 0.55), lineWidth: 1.5, showInLegend: false };
  return { enabled: true, overlap: false, defaultColors: [] as string[], style };
}
