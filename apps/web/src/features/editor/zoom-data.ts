import { ENTITY_CATALOG, RELATIONSHIP_LABELS_ES, type EvidenceClass, type GraphEdgeData, type GraphNodeData, type GraphSnapshot } from "@a-link/shared";
import { type AuraMode, auraIdOf } from "./auras";
import { customShapeFor } from "./shapes";
import type { ZcLinkData, ZcNodeData } from "./zoomcharts";

/** Radio base del nodo en px de escena; cada forma lo escala con sus factores. */
export const NODE_RADIUS = 28;

/** Resuelve la URL (del mismo origen o `blob:`) de la imagen de una entidad; `undefined` si no tiene. */
export type ImageUrlResolver = (node: GraphNodeData) => string | undefined;

const LINK_COLOR = "#64748b";

/**
 * La certeza de una relación NO depende solo del color: trazo continuo = registrada, discontinuo = hipótesis,
 * punteado = observación. Así se distingue también en escala de grises o sin percibir colores.
 */
const EVIDENCE_DASH: Readonly<Record<EvidenceClass, number[] | undefined>> = {
  recorded: undefined,
  hypothesis: [10, 6],
  observation: [2, 6],
};

/**
 * `auraMode` agrupa la entidad en un halo (presentación). `remembered` es la última posición que tuvo en el lienzo
 * una entidad que se ocultó y vuelve a mostrarse: solo se usa si el documento no guarda posición propia.
 */
export function toZoomNode(node: GraphNodeData, auraMode: AuraMode = "none", remembered?: { x: number; y: number }, imageUrl?: ImageUrlResolver): ZcNodeData {
  const def = ENTITY_CATALOG[node.type];
  const saved = node.positionX !== null && node.positionY !== null ? { x: node.positionX as number, y: node.positionY as number } : undefined;
  const pos = saved ?? remembered;
  const aura = auraIdOf(node, auraMode);
  const image = node.imageId ? imageUrl?.(node) : undefined;
  return {
    id: node.id,
    loaded: true,
    style: {
      display: "customShape",
      customShape: customShapeFor(node.type),
      fillColor: def.defaultColor,
      radius: NODE_RADIUS,
      label: node.label,
      // Al QUITAR una imagen el estilo anterior sobrevive a `addData` (se fusiona): lo corrige `nodeStyleFunction` en el lienzo.
      ...(image ? { image } : {}),
      ...(aura ? { aura } : {}),
    },
    ...(pos ? { x: pos.x, y: pos.y, locked: true } : {}),
  };
}

export function toZoomLink(edge: GraphEdgeData): ZcLinkData {
  const dir = edge.metadata.direction ?? "forward";
  const dash = EVIDENCE_DASH[edge.metadata.evidenceClass ?? "hypothesis"];
  return {
    id: edge.id,
    from: edge.sourceId,
    to: edge.targetId,
    style: {
      fillColor: LINK_COLOR,
      radius: 2.5,
      label: edge.label || RELATIONSHIP_LABELS_ES[edge.relationshipType],
      ...(dash ? { lineDash: dash } : {}),
      toDecoration: dir === "none" ? undefined : "arrow",
      fromDecoration: dir === "both" ? "arrow" : undefined,
    },
  };
}

/** Convierte el documento del editor al formato de datos de NetChart. Función pura, sin ZoomCharts. */
export function toZoomData(doc: GraphSnapshot, auraMode: AuraMode = "none", imageUrl?: ImageUrlResolver): { nodes: ZcNodeData[]; links: ZcLinkData[] } {
  return { nodes: doc.nodes.map((n) => toZoomNode(n, auraMode, undefined, imageUrl)), links: doc.edges.map(toZoomLink) };
}
