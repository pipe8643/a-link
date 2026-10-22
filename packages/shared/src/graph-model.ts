import { z } from "zod";
import { ENTITY_TYPE_IDS, metadataSchemaFor } from "./entity-catalog.js";
import { RELATIONSHIP_TYPES, edgeMetadataSchema } from "./relationships.js";

/**
 * Modelo de dominio de un grafo (nodos y aristas) y sus reglas de validación.
 *
 * Es la ÚNICA definición: el editor (cliente) la usa para validar lo que escribe el usuario y la API
 * (Fase 5) la usará para validar lo que recibe. El cliente nunca es de fiar: la validación del servidor
 * es la que cuenta; esta se comparte para que ambas coincidan.
 */
export const GRAPH_LIMITS = {
  maxNodes: 5000,
  maxEdges: 20000,
  labelMax: 200,
  descriptionMax: 2000,
  notesMax: 8000,
  maxTags: 20,
  tagMax: 40,
  edgeLabelMax: 200,
  /** Coordenadas razonables: evita NaN/Infinity y valores absurdos que rompen el lienzo. */
  coordMax: 1_000_000,
  /** Imágenes de entidades (ya recortadas por el cliente): se guardan en la base de datos, no en disco. */
  maxImagesPerGraph: 500,
} as const;

/** Límites de las imágenes de entidades. El cliente las recorta y reduce; el servidor vuelve a comprobarlo todo. */
export const IMAGE_LIMITS = {
  /** Tamaño máximo de un archivo ya recortado. Un retrato de 384 px en JPEG/WebP ocupa 20-60 KB. */
  maxBytes: 262_144,
  /** Lado máximo en px. */
  maxSide: 512,
  /** Lado al que el cliente reduce el recorte. */
  outputSide: 384,
  /** Espacio total por cuenta. */
  maxBytesPerUser: 64 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
} as const;

// Sin caracteres de control (salvo salto de línea y tabulador en textos largos).
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const noControl = (v: string) => !CONTROL_CHARS.test(v);
const CONTROL_MESSAGE = "No se admiten caracteres de control.";

const shortText = (max: number) => z.string().trim().max(max).refine(noControl, CONTROL_MESSAGE);

const singleLine = (v: string) => !/[\r\n\t]/.test(v);

export const nodeLabelSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(GRAPH_LIMITS.labelMax, `Máximo ${GRAPH_LIMITS.labelMax} caracteres.`)
  .refine(noControl, CONTROL_MESSAGE)
  .refine(singleLine, "El nombre debe ir en una sola línea.");

export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Una etiqueta no puede estar vacía.")
      .max(GRAPH_LIMITS.tagMax, `Cada etiqueta admite como máximo ${GRAPH_LIMITS.tagMax} caracteres.`)
      .refine(noControl, CONTROL_MESSAGE)
      .refine(singleLine, "Las etiquetas van en una sola línea."),
  )
  .max(GRAPH_LIMITS.maxTags, `Máximo ${GRAPH_LIMITS.maxTags} etiquetas.`)
  .refine((tags) => new Set(tags.map((t) => t.toLocaleLowerCase("es"))).size === tags.length, "Hay etiquetas repetidas.");

const coordinate = z.number().finite().min(-GRAPH_LIMITS.coordMax).max(GRAPH_LIMITS.coordMax);

export const nodeInputSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(ENTITY_TYPE_IDS),
    label: nodeLabelSchema,
    description: shortText(GRAPH_LIMITS.descriptionMax).default(""),
    notes: shortText(GRAPH_LIMITS.notesMax).default(""),
    tags: tagsSchema.default([]),
    metadata: z.record(z.string(), z.string().optional()).default({}),
    /** Imagen de la entidad (identificador de una imagen subida a ESTE grafo; el servidor lo comprueba). */
    imageId: z.uuid().nullable().default(null),
    positionX: coordinate.nullable().default(null),
    positionY: coordinate.nullable().default(null),
  })
  .strict()
  .superRefine((node, ctx) => {
    const result = metadataSchemaFor(node.type).safeParse(node.metadata);
    if (!result.success) {
      for (const issue of result.error.issues) {
        // `strict()` informa las claves desconocidas en `path: []`; se atribuyen al campo raíz.
        const keys = issue.code === "unrecognized_keys" ? issue.keys : [];
        if (keys.length > 0) {
          for (const key of keys) ctx.addIssue({ code: "custom", path: ["metadata", key], message: "Campo no permitido para este tipo." });
        } else {
          ctx.addIssue({ code: "custom", path: ["metadata", ...issue.path], message: issue.message });
        }
      }
    }
  })
  .transform((node) => ({
    ...node,
    // Valores vacíos fuera: lo que se guarda es solo lo que el usuario rellenó.
    metadata: Object.fromEntries(
      Object.entries(metadataSchemaFor(node.type).parse(node.metadata)).filter(([, v]) => v !== undefined),
    ) as Record<string, string>,
    positionX: node.positionX === null || node.positionY === null ? null : node.positionX,
    positionY: node.positionX === null || node.positionY === null ? null : node.positionY,
  }));

export type GraphNodeData = z.output<typeof nodeInputSchema>;

export const edgeInputSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    targetId: z.uuid(),
    relationshipType: z.enum(RELATIONSHIP_TYPES),
    label: shortText(GRAPH_LIMITS.edgeLabelMax).refine(singleLine, "La etiqueta va en una sola línea.").default(""),
    metadata: edgeMetadataSchema.default({ direction: "forward", evidenceClass: "hypothesis" }),
  })
  .strict()
  .refine((e) => e.sourceId !== e.targetId, {
    message: "Una relación debe unir dos entidades distintas.",
    path: ["targetId"],
  });

export type GraphEdgeData = z.output<typeof edgeInputSchema>;

/**
 * Grafo completo. Comprueba lo que no puede verse mirando un nodo o una arista sueltos: IDs únicos,
 * extremos de cada arista existentes y límites de tamaño.
 */
export const graphSnapshotSchema = z
  .object({
    nodes: z.array(nodeInputSchema).max(GRAPH_LIMITS.maxNodes, `Máximo ${GRAPH_LIMITS.maxNodes} entidades por grafo.`),
    edges: z.array(edgeInputSchema).max(GRAPH_LIMITS.maxEdges, `Máximo ${GRAPH_LIMITS.maxEdges} relaciones por grafo.`),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    graph.nodes.forEach((n, i) => {
      if (nodeIds.has(n.id)) ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: "Identificador de entidad repetido." });
      nodeIds.add(n.id);
    });
    const edgeIds = new Set<string>();
    graph.edges.forEach((e, i) => {
      if (edgeIds.has(e.id)) ctx.addIssue({ code: "custom", path: ["edges", i, "id"], message: "Identificador de relación repetido." });
      edgeIds.add(e.id);
      if (!nodeIds.has(e.sourceId)) ctx.addIssue({ code: "custom", path: ["edges", i, "sourceId"], message: "El origen no existe en el grafo." });
      if (!nodeIds.has(e.targetId)) ctx.addIssue({ code: "custom", path: ["edges", i, "targetId"], message: "El destino no existe en el grafo." });
    });
  });

export type GraphSnapshot = z.output<typeof graphSnapshotSchema>;

// --- Guardado del contenido (PUT /graphs/:id/content) -------------------------------------------

export const MAX_REVISION = 2_147_483_647; // INT de MySQL

export interface ContentIssue {
  field: string;
  rule: string;
}

export type GraphContentSave = GraphSnapshot & { expectedRevision: number };

/**
 * Valida el cuerpo del guardado: `{ expectedRevision, nodes, edges }` y nada más. Lo usan el servidor (que es
 * quien decide) y el cliente (para no enviar lo que se sabe inválido). Los mensajes describen la regla y el
 * campo, NUNCA el valor recibido (el contenido de un grafo puede ser sensible y acabaría en logs/respuestas).
 */
export function parseGraphContentSave(raw: unknown): { ok: true; value: GraphContentSave } | { ok: false; errors: ContentIssue[] } {
  const bad = (field: string, rule: string) => ({ ok: false as const, errors: [{ field, rule }] });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("body", "Se esperaba un objeto.");
  const body = raw as Record<string, unknown>;

  const unknown = Object.keys(body).filter((k) => k !== "expectedRevision" && k !== "nodes" && k !== "edges");
  if (unknown.length > 0) return { ok: false, errors: unknown.slice(0, 10).map((k) => ({ field: k, rule: "Campo no permitido." })) };

  const rev = body.expectedRevision;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1 || rev > MAX_REVISION) {
    return bad("expectedRevision", "Debe ser un entero positivo.");
  }

  const parsed = graphSnapshotSchema.safeParse({ nodes: body.nodes, edges: body.edges });
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => ({ field: i.path.map(String).join(".") || "body", rule: i.message }));
    return { ok: false, errors };
  }
  return { ok: true, value: { ...parsed.data, expectedRevision: rev } };
}

/** Lo que devuelve GET /graphs/:id/content. */
export interface GraphContentResponse extends GraphSnapshot {
  revision: number;
  graphDataVersion: number;
}
