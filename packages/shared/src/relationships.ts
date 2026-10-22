import { z } from "zod";

export const RELATIONSHIP_TYPES = [
  "ownership", // Propiedad
  "title_holder", // Titularidad
  "family", // Familiar
  "association", // Asociación
  "contact", // Contacto
  "device_usage", // Uso de dispositivo
  "digital_link", // Vinculación digital
  "location", // Ubicación
  "commercial", // Relación comercial
  "custom", // Personalizada
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_LABELS_ES: Readonly<Record<RelationshipType, string>> = {
  ownership: "Propiedad",
  title_holder: "Titularidad",
  family: "Familiar",
  association: "Asociación",
  contact: "Contacto",
  device_usage: "Uso de dispositivo",
  digital_link: "Vinculación digital",
  location: "Ubicación",
  commercial: "Relación comercial",
  custom: "Personalizada",
};

/**
 * Naturaleza del dato. La aplicación NUNCA infiere que una relación es un hecho verificado:
 * el valor por defecto es `hypothesis` y debe elevarlo explícitamente el usuario.
 */
export const EVIDENCE_CLASSES = ["recorded", "hypothesis", "observation"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const EVIDENCE_LABELS_ES: Readonly<Record<EvidenceClass, string>> = {
  recorded: "Dato registrado",
  hypothesis: "Hipótesis",
  observation: "Observación",
};

export const EDGE_DIRECTIONS = ["forward", "none", "both"] as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha con formato AAAA-MM-DD.")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Fecha no válida.");

/** Metadatos de una relación (campo `metadata` JSON de GraphEdge). Estricto. */
export const edgeMetadataSchema = z
  .object({
    description: z.string().trim().max(2000).optional(),
    direction: z.enum(EDGE_DIRECTIONS).default("forward"),
    evidenceClass: z.enum(EVIDENCE_CLASSES).default("hypothesis"),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    source: z.string().trim().max(500).optional(),
    /** 0..100, opcional ("si se configura"). */
    confidence: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((m) => !m.startDate || !m.endDate || m.startDate <= m.endDate, {
    message: "La fecha de inicio no puede ser posterior a la de finalización.",
    path: ["endDate"],
  });

export type EdgeMetadata = z.infer<typeof edgeMetadataSchema>;
