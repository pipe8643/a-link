/**
 * Catálogo de tipos de entidad. Es la ÚNICA fuente de verdad de:
 *  - identificadores estables (se guardan en la base de datos, NO se renombran),
 *  - nombres en español,
 *  - representación visual deseada (forma, color, icono),
 *  - campos específicos y sus reglas de validación.
 *
 * `shape` expresa la forma DESEADA. Cómo se dibuja en ZoomCharts es responsabilidad del frontend
 * (ver docs/01-verificacion-zoomcharts.md §2: algunas formas no son nativas para nodos de NetChart).
 */
import { z } from "zod";

export const ENTITY_TYPE_IDS = [
  "person",
  "property",
  "vehicle",
  "phone",
  "social",
  "organization",
  "bank_account",
  "document",
  "location",
  "other",
] as const;

export type EntityTypeId = (typeof ENTITY_TYPE_IDS)[number];

export type EntityShape =
  | "circle"
  | "square"
  | "triangle"
  | "hexagon"
  | "diamond"
  | "rounded_rect"
  | "icon_bank"
  | "icon_document"
  | "icon_location"
  | "custom";

export type FieldKind = "text" | "longtext" | "select" | "url";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Dato sensible: se enmascara en listados/búsqueda y no se escribe nunca en logs. */
  sensitive?: boolean;
  maxLength: number;
  options?: readonly FieldOption[];
  /** Expresión regular (sin banderas) que debe cumplir el valor no vacío. */
  pattern?: string;
  patternMessage?: string;
}

export interface EntityTypeDef {
  id: EntityTypeId;
  name: string;
  shape: EntityShape;
  defaultColor: string;
  /** Nombre de icono opcional (el frontend lo resuelve a un SVG). */
  icon?: string;
  fields: readonly FieldDef[];
}

const OBSERVATIONS: FieldDef = {
  key: "observations",
  label: "Observaciones",
  kind: "longtext",
  maxLength: 4000,
};

export const ENTITY_CATALOG: Readonly<Record<EntityTypeId, EntityTypeDef>> = {
  person: {
    id: "person",
    name: "Persona",
    shape: "circle",
    defaultColor: "#2563eb",
    icon: "user",
    fields: [
      { key: "fullName", label: "Nombre", kind: "text", maxLength: 200 },
      { key: "alias", label: "Alias", kind: "text", maxLength: 200 },
      {
        key: "internalId",
        label: "Identificador interno",
        kind: "text",
        sensitive: true,
        maxLength: 64,
      },
      OBSERVATIONS,
    ],
  },
  property: {
    id: "property",
    name: "Bien inmueble",
    shape: "square",
    defaultColor: "#16a34a",
    icon: "home",
    fields: [
      { key: "address", label: "Dirección", kind: "text", maxLength: 300 },
      {
        key: "propertyType",
        label: "Tipo de inmueble",
        kind: "select",
        maxLength: 40,
        options: [
          { value: "house", label: "Casa" },
          { value: "apartment", label: "Departamento" },
          { value: "land", label: "Terreno" },
          { value: "commercial", label: "Local comercial" },
          { value: "other", label: "Otro" },
        ],
      },
      {
        key: "cadastralId",
        label: "Identificador catastral",
        kind: "text",
        sensitive: true,
        maxLength: 64,
      },
      OBSERVATIONS,
    ],
  },
  vehicle: {
    id: "vehicle",
    name: "Vehículo",
    shape: "triangle",
    defaultColor: "#ea580c",
    icon: "car",
    fields: [
      { key: "make", label: "Marca", kind: "text", maxLength: 80 },
      { key: "model", label: "Modelo", kind: "text", maxLength: 80 },
      {
        key: "plate",
        label: "Matrícula",
        kind: "text",
        sensitive: true,
        maxLength: 16,
        pattern: "^[A-Za-z0-9][A-Za-z0-9 -]{1,14}[A-Za-z0-9]$",
        patternMessage: "La matrícula solo admite letras, números, espacios y guiones.",
      },
      {
        key: "vin",
        label: "VIN",
        kind: "text",
        sensitive: true,
        maxLength: 17,
        pattern: "^[A-HJ-NPR-Za-hj-npr-z0-9]{17}$",
        patternMessage: "El VIN debe tener 17 caracteres alfanuméricos (sin I, O ni Q).",
      },
      OBSERVATIONS,
    ],
  },
  phone: {
    id: "phone",
    name: "Teléfono",
    shape: "hexagon",
    defaultColor: "#7c3aed",
    icon: "phone",
    fields: [
      {
        key: "number",
        label: "Número",
        kind: "text",
        sensitive: true,
        maxLength: 24,
        pattern: "^\\+?[0-9][0-9 ()-]{5,22}$",
        patternMessage: "Número de teléfono no válido.",
      },
      {
        key: "country",
        label: "País (ISO 3166-1 alfa-2)",
        kind: "text",
        maxLength: 2,
        pattern: "^[A-Za-z]{2}$",
        patternMessage: "Use un código de país de 2 letras.",
      },
      {
        key: "lineType",
        label: "Tipo de línea",
        kind: "select",
        maxLength: 20,
        options: [
          { value: "mobile", label: "Móvil" },
          { value: "landline", label: "Fija" },
          { value: "voip", label: "VoIP" },
          { value: "unknown", label: "Desconocido" },
        ],
      },
      OBSERVATIONS,
    ],
  },
  social: {
    id: "social",
    name: "Red social",
    shape: "diamond",
    defaultColor: "#db2777",
    icon: "at-sign",
    fields: [
      { key: "platform", label: "Plataforma", kind: "text", maxLength: 80 },
      { key: "username", label: "Nombre de usuario", kind: "text", maxLength: 120 },
      { key: "profileUrl", label: "URL del perfil", kind: "url", maxLength: 500 },
      OBSERVATIONS,
    ],
  },
  organization: {
    id: "organization",
    name: "Organización o empresa",
    shape: "rounded_rect",
    defaultColor: "#0891b2",
    icon: "building",
    fields: [
      { key: "legalName", label: "Razón social", kind: "text", maxLength: 250 },
      { key: "taxId", label: "Identificador fiscal", kind: "text", sensitive: true, maxLength: 40 },
      { key: "sector", label: "Sector", kind: "text", maxLength: 120 },
      OBSERVATIONS,
    ],
  },
  bank_account: {
    id: "bank_account",
    name: "Cuenta bancaria",
    shape: "icon_bank",
    defaultColor: "#ca8a04",
    icon: "landmark",
    fields: [
      { key: "bank", label: "Entidad", kind: "text", maxLength: 120 },
      {
        key: "accountRef",
        label: "Referencia de cuenta",
        kind: "text",
        sensitive: true,
        maxLength: 40,
      },
      { key: "currency", label: "Moneda", kind: "text", maxLength: 3, pattern: "^[A-Za-z]{3}$" },
      OBSERVATIONS,
    ],
  },
  document: {
    id: "document",
    name: "Documento",
    shape: "icon_document",
    defaultColor: "#475569",
    icon: "file-text",
    fields: [
      { key: "title", label: "Título", kind: "text", maxLength: 250 },
      { key: "reference", label: "Referencia", kind: "text", sensitive: true, maxLength: 80 },
      { key: "issuedOn", label: "Fecha del documento (AAAA-MM-DD)", kind: "text", maxLength: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      OBSERVATIONS,
    ],
  },
  location: {
    id: "location",
    name: "Ubicación",
    shape: "icon_location",
    defaultColor: "#dc2626",
    icon: "map-pin",
    fields: [
      { key: "address", label: "Dirección o descripción", kind: "text", maxLength: 300 },
      { key: "latitude", label: "Latitud", kind: "text", maxLength: 12, pattern: "^-?\\d{1,2}(\\.\\d+)?$" },
      { key: "longitude", label: "Longitud", kind: "text", maxLength: 13, pattern: "^-?\\d{1,3}(\\.\\d+)?$" },
      OBSERVATIONS,
    ],
  },
  other: {
    id: "other",
    name: "Otro",
    shape: "custom",
    defaultColor: "#64748b",
    icon: "circle-help",
    fields: [{ key: "kind", label: "Clase", kind: "text", maxLength: 120 }, OBSERVATIONS],
  },
};

export function isEntityTypeId(value: unknown): value is EntityTypeId {
  return typeof value === "string" && (ENTITY_TYPE_IDS as readonly string[]).includes(value);
}

export function getEntityType(id: EntityTypeId): EntityTypeDef {
  return ENTITY_CATALOG[id];
}

// ---------------------------------------------------------------------------------------------
// Validación de `metadata` específica por tipo
// ---------------------------------------------------------------------------------------------

function fieldSchema(field: FieldDef): z.ZodType<string | undefined> {
  // Quita espacios y trata "" como ausente (los campos son opcionales salvo `required`).
  let base: z.ZodType<string> = z.string().trim().max(field.maxLength, {
    message: `${field.label}: máximo ${field.maxLength} caracteres.`,
  });

  if (field.pattern) {
    const re = new RegExp(field.pattern);
    base = base.refine((v) => v === "" || re.test(v), {
      message: field.patternMessage ?? `${field.label}: formato no válido.`,
    });
  }

  if (field.kind === "select" && field.options) {
    const allowed = new Set(field.options.map((o) => o.value));
    base = base.refine((v) => v === "" || allowed.has(v), {
      message: `${field.label}: opción no válida.`,
    });
  }

  if (field.kind === "url") {
    // Solo http/https: bloquea javascript:, data:, file:, etc. (defensa XSS).
    base = base.refine(
      (v) => {
        if (v === "") return true;
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: `${field.label}: debe ser una URL http o https válida.` },
    );
  }

  if (field.required) {
    base = base.refine((v) => v !== "", { message: `${field.label}: es obligatorio.` });
  }

  return base.transform((v) => (v === "" ? undefined : v));
}

/**
 * Devuelve un esquema Zod ESTRICTO para el `metadata` de un tipo: rechaza claves desconocidas
 * (evita que se almacene contenido arbitrario en el JSON).
 */
export function metadataSchemaFor(type: EntityTypeId) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const field of ENTITY_CATALOG[type].fields) {
    shape[field.key] = fieldSchema(field).optional();
  }
  return z.object(shape).strict();
}

export type NodeMetadata = Record<string, string | undefined>;

/** Claves de `metadata` marcadas como sensibles para un tipo. */
export function sensitiveKeysFor(type: EntityTypeId): string[] {
  return ENTITY_CATALOG[type].fields.filter((f) => f.sensitive).map((f) => f.key);
}

/** Copia de `metadata` con los campos sensibles enmascarados (para listados y búsqueda). */
export function maskSensitive(type: EntityTypeId, metadata: NodeMetadata): NodeMetadata {
  const sensitive = new Set(sensitiveKeysFor(type));
  const out: NodeMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = sensitive.has(key) && value ? "••••" : value;
  }
  return out;
}
