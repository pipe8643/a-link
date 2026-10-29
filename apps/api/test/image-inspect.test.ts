import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS } from "@a-link/shared";
import { InvalidImageError, inspectImage } from "../src/images/image-inspect.js";
import { makeCleanJpeg, makeCleanPng, makeCleanWebp, makeJpeg, makePng } from "./helpers/files.js";

const reason = (data: Buffer): string | null => {
  try {
    inspectImage(data);
    return null;
  } catch (err) {
    if (err instanceof InvalidImageError) return err.reason;
    throw err;
  }
};

describe("inspección estructural de imágenes subidas", () => {
  it("reconoce PNG, JPEG y WebP por su contenido y lee las dimensiones del encabezado", () => {
    expect(inspectImage(makeCleanPng(30, 20))).toEqual({ mime: "image/png", width: 30, height: 20 });
    expect(inspectImage(makeCleanJpeg(31, 21))).toEqual({ mime: "image/jpeg", width: 31, height: 21 });
    expect(inspectImage(makeCleanWebp(32, 22))).toEqual({ mime: "image/webp", width: 32, height: 22 });
  });

  it("rechaza lo que no es una imagen admitida (por contenido, no por nombre ni tipo declarado)", () => {
    expect(reason(Buffer.from("<html><script>alert(1)</script></html>"))).toBe("unsupported");
    expect(reason(Buffer.from("GIF89a....................."))).toBe("unsupported");
    expect(reason(Buffer.from("%PDF-1.7 ......................"))).toBe("unsupported");
    expect(reason(Buffer.alloc(0))).toBe("unsupported");
    expect(reason(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBe("unsupported");
  });

  it("rechaza imágenes con metadatos que pueden ser personales (EXIF/GPS, XMP, texto) en los tres formatos", () => {
    expect(reason(makeCleanJpeg(8, 8, { exif: true }))).toBe("metadata");
    expect(reason(makeCleanWebp(8, 8, { exif: true }))).toBe("metadata");
    expect(reason(makePng())).toBe("metadata"); // makePng lleva un fragmento tEXt
    expect(reason(makeCleanPng())).toBeNull();
  });

  it("acepta un lado mayor cuando se pide (membrete) y sigue rechazando el tope de entidades", () => {
    const wide = makeCleanPng(600, 400);
    expect(reason(wide)).toBe("dimensions");
    expect(inspectImage(wide, 4096)).toEqual({ mime: "image/png", width: 600, height: 400 });
  });

  it("rechaza dimensiones fuera de límite y archivos dañados o truncados", () => {
    expect(reason(makeCleanPng(IMAGE_LIMITS.maxSide + 1, 4))).toBe("dimensions");
    expect(reason(makeCleanJpeg(4, IMAGE_LIMITS.maxSide + 1))).toBe("dimensions");
    expect(reason(makeCleanWebp(IMAGE_LIMITS.maxSide + 1, 4))).toBe("dimensions");
    const png = makeCleanPng(8, 8);
    expect(reason(png.subarray(0, png.length - 8))).toBe("corrupt"); // sin IEND
    expect(reason(png.subarray(0, 30))).toBe("corrupt");
    expect(reason(makeJpeg())).toBe("corrupt"); // JPEG sin SOF: no se pueden leer las dimensiones
    const jpeg = makeCleanJpeg(8, 8);
    expect(reason(jpeg.subarray(0, 10))).toBe("corrupt");
    const webp = makeCleanWebp(8, 8);
    expect(reason(webp.subarray(0, 20))).toBe("corrupt");
  });

  it("no se cuelga ni lanza errores inesperados con basura que empieza con una firma válida (fuzz)", () => {
    const heads = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("RIFF\0\0\0\0WEBP", "latin1")];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255);
    for (let i = 0; i < 3000; i++) {
      const tail = Buffer.from(Array.from({ length: (i % 60) + 1 }, rnd));
      const data = Buffer.concat([heads[i % 3]!, tail]);
      expect(() => inspectImage(data)).not.toThrow(/^(?!La imagen|El archivo)/); // solo InvalidImageError con mensaje propio
    }
  });
});
