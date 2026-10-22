import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/** Ficheros mínimos pero estructuralmente válidos para probar la subida (todo sintético). Cada uno es único por `seed`. */
export function makePng(seed = randomBytes(4).toString("hex")): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`seed\0${seed}`, "latin1")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function makeJpeg(seed = randomBytes(4).toString("hex")): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), Buffer.from(seed), Buffer.from([0xff, 0xd9])]);
}

export function makePdf(seed = randomBytes(4).toString("hex")): Buffer {
  return Buffer.from(`%PDF-1.7\n% ${seed}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
}

/** ZIP sin compresión con las entradas indicadas (formato mínimo válido: entradas locales + directorio central + EOCD). */
export function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

export function makePptx(seed = randomBytes(4).toString("hex")): Buffer {
  return makeZip({ "[Content_Types].xml": "<Types/>", "ppt/presentation.xml": `<p:presentation seed="${seed}"/>` });
}

export const MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

// --- Imágenes de entidades (ya recortadas): PNG/JPEG/WebP SIN metadatos, con las dimensiones pedidas -----------------

const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** PNG limpio (sin fragmentos de texto/EXIF). `seed` cambia el contenido para generar imágenes distintas. */
export function makeCleanPng(width = 8, height = 8, seed = randomBytes(2).toString("hex")): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0);
  Buffer.from(seed, "hex").copy(row, 1);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG con cabeceras válidas (JFIF + SOF0 + SOS); `exif` añade un segmento APP1 «Exif». */
export function makeCleanJpeg(width = 8, height = 8, opts: { seed?: string; exif?: boolean } = {}): Buffer {
  const seed = Buffer.from(opts.seed ?? randomBytes(4).toString("hex"));
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const jfif = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const exif = opts.exif ? Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x12]), Buffer.from("Exif\0\0GPS-DEMO!!", "latin1")]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, sof, sos, seed, Buffer.from([0xff, 0xd9])]);
}

/** WebP sin pérdida (VP8L) mínimo; `exif` añade un fragmento EXIF. */
export function makeCleanWebp(width = 8, height = 8, opts: { seed?: string; exif?: boolean } = {}): Buffer {
  const payload = Buffer.alloc(5 + 8);
  payload[0] = 0x2f;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  Buffer.from((opts.seed ?? randomBytes(4).toString("hex")).padEnd(8, "0").slice(0, 8), "latin1").copy(payload, 5);
  const chunk = (fourcc: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8L", payload), opts.exif ? chunk("EXIF", Buffer.from("Exif\0\0GPS", "latin1")) : Buffer.alloc(0)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}