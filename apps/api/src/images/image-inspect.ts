import { IMAGE_LIMITS } from "@a-link/shared";

/**
 * Inspección ESTRUCTURAL de una imagen subida. No se decodifica ni se reencuadra nada (eso lo hace el navegador antes de
 * subir): aquí solo se comprueba que lo recibido es de verdad un PNG, JPEG o WebP, se leen sus dimensiones del encabezado
 * y se rechaza lo que pueda arrastrar metadatos personales (EXIF con GPS/cámara, XMP, texto incrustado).
 *
 * Una imagen recortada con `canvas.toBlob` no lleva ninguno de ellos, así que rechazarlos no afecta al uso normal y
 * obliga a que ninguna foto original (con su ubicación) llegue a guardarse.
 */
export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

export class InvalidImageError extends Error {
  constructor(
    readonly reason: "unsupported" | "corrupt" | "dimensions" | "metadata",
    message: string,
  ) {
    super(message);
    this.name = "InvalidImageError";
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Fragmentos PNG que pueden contener metadatos personales. */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
const corrupt = (what: string) => new InvalidImageError("corrupt", `La imagen está dañada o incompleta (${what}).`);

function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw corrupt("dimensiones");
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    throw new InvalidImageError("dimensions", `La imagen no puede superar ${IMAGE_LIMITS.maxSide} × ${IMAGE_LIMITS.maxSide} px.`);
  }
}

function inspectPng(data: Buffer): ImageInfo {
  if (data.length < 33 || data.toString("latin1", 12, 16) !== "IHDR") throw corrupt("PNG");
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  let pos = 8;
  let sawEnd = false;
  while (pos + 12 <= data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString("latin1", pos + 4, pos + 8);
    if (PNG_METADATA_CHUNKS.has(type)) throw new InvalidImageError("metadata", "La imagen lleva metadatos incrustados. Vuelve a recortarla en la aplicación.");
    const next = pos + 12 + len;
    if (next > data.length) throw corrupt("fragmento PNG");
    pos = next;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw corrupt("PNG sin final");
  checkDimensions(width, height);
  return { mime: "image/png", width, height };
}

/** Marcadores JPEG que pueden llevar metadatos personales: EXIF/XMP (APP1), IPTC (APP13) y comentarios. */
const isJpegMetadataMarker = (marker: number): boolean => marker === 0xe1 || marker === 0xed || marker === 0xfe;

function inspectJpeg(data: Buffer): ImageInfo {
  let pos = 2;
  let size: { width: number; height: number } | null = null;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) throw corrupt("marcador JPEG");
    let marker = data[pos + 1]!;
    while (marker === 0xff && pos + 2 < data.length) {
      pos++;
      marker = data[pos + 1]!;
    }
    pos += 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // sin longitud
    if (marker === 0xd9) break; // EOI
    if (pos + 2 > data.length) throw corrupt("segmento JPEG");
    const len = data.readUInt16BE(pos);
    if (len < 2 || pos + len > data.length) throw corrupt("segmento JPEG");
    if (isJpegMetadataMarker(marker)) throw new InvalidImageError("metadata", "La imagen lleva metadatos incrustados. Vuelve a recortarla en la aplicación.");
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && !size) {
      if (len < 8) throw corrupt("SOF");
      size = { height: data.readUInt16BE(pos + 3), width: data.readUInt16BE(pos + 5) };
    }
    if (marker === 0xda) break; // inicio de los datos de imagen: ya no hay más cabeceras
    pos += len;
  }
  if (!size) throw corrupt("JPEG sin dimensiones");
  checkDimensions(size.width, size.height);
  return { mime: "image/jpeg", ...size };
}

function inspectWebp(data: Buffer): ImageInfo {
  if (data.length < 30) throw corrupt("WebP");
  const riffSize = data.readUInt32LE(4);
  if (riffSize + 8 > data.length + 1) throw corrupt("WebP truncado");
  let width = 0;
  let height = 0;
  let found = false;
  let pos = 12;
  while (pos + 8 <= data.length) {
    const fourcc = data.toString("latin1", pos, pos + 4);
    const len = data.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (body + len > data.length) throw corrupt("fragmento WebP");
    if (fourcc === "EXIF" || fourcc === "XMP ") throw new InvalidImageError("metadata", "La imagen lleva metadatos incrustados. Vuelve a recortarla en la aplicación.");
    if (!found) {
      if (fourcc === "VP8X" && len >= 10) {
        width = 1 + (data[body + 4]! | (data[body + 5]! << 8) | (data[body + 6]! << 16));
        height = 1 + (data[body + 7]! | (data[body + 8]! << 8) | (data[body + 9]! << 16));
        found = true;
      } else if (fourcc === "VP8L" && len >= 5 && data[body] === 0x2f) {
        const bits = data.readUInt32LE(body + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
        found = true;
      } else if (fourcc === "VP8 " && len >= 10 && data[body + 3] === 0x9d && data[body + 4] === 0x01 && data[body + 5] === 0x2a) {
        width = data.readUInt16LE(body + 6) & 0x3fff;
        height = data.readUInt16LE(body + 8) & 0x3fff;
        found = true;
      }
    }
    pos = body + len + (len % 2); // los fragmentos se alinean a 2 bytes
  }
  if (!found) throw corrupt("WebP sin dimensiones");
  checkDimensions(width, height);
  return { mime: "image/webp", width, height };
}

/** Devuelve el tipo REAL y las dimensiones, o lanza `InvalidImageError`. */
export function inspectImage(data: Buffer): ImageInfo {
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return inspectPng(data);
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return inspectJpeg(data);
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return inspectWebp(data);
  throw new InvalidImageError("unsupported", "El archivo no es una imagen PNG, JPEG o WebP válida.");
}
