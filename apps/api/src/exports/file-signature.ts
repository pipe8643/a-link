/**
 * Detección del formato REAL de un fichero por su contenido binario. El tipo MIME y el nombre que declara el cliente
 * no se creen: se comprueba la firma y, solo si coincide, se guarda con el tipo que corresponde a ese contenido.
 *
 * Es una comprobación estructural (firma + estructura mínima), no un análisis antivirus: un PDF o un PowerPoint
 * válido puede contener cosas activas. Por eso las descargas llevan `Content-Disposition: attachment` y `nosniff`.
 */
export type StoredFormat = "PNG" | "JPEG" | "PDF" | "PPTX";

export const FORMAT_MIME: Readonly<Record<StoredFormat, string>> = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  PDF: "application/pdf",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const FORMAT_EXTENSION: Readonly<Record<StoredFormat, string>> = { PNG: "png", JPEG: "jpg", PDF: "pdf", PPTX: "pptx" };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Nombres de las entradas de un ZIP leyendo su directorio central (sin descomprimir nada). `null` si no es un ZIP legible. */
export function zipEntryNames(data: Buffer): string[] | null {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const minOffset = Math.max(0, data.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = data.length - 22; i >= minOffset; i--) {
    if (data.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = data.readUInt16LE(eocd + 10);
  const dirSize = data.readUInt32LE(eocd + 12);
  const dirOffset = data.readUInt32LE(eocd + 16);
  if (total === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return null; // ZIP64: no se admite
  if (dirOffset + dirSize > eocd) return null;

  const names: string[] = [];
  let p = dirOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== CENTRAL) return null;
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    if (p + 46 + nameLen > data.length) return null;
    names.push(data.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function detectFormat(data: Buffer): StoredFormat | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.toString("latin1", 12, 16) === "IHDR") return "PNG";
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "JPEG";
  if (data.length >= 8 && data.toString("latin1", 0, 5) === "%PDF-") return "PDF";
  if (data.length >= 22 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    const names = zipEntryNames(data);
    // Un PPTX de verdad contiene siempre el índice de tipos de contenido y la presentación.
    if (names && names.includes("[Content_Types].xml") && names.includes("ppt/presentation.xml")) return "PPTX";
  }
  return null;
}

/** Normaliza un `Content-Type` declarado (sin parámetros, en minúsculas). */
export function normalizeMime(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}
