// Genera src/features/editor/glyphs.generated.ts: rutas SVG (viewBox 24x24, trazo) de los iconos del
// catálogo, tomadas de lucide (licencia ISC). Se usan para dibujar el glifo DENTRO de cada nodo del
// lienzo (Canvas Path2D) con el mismo aspecto que los iconos de la paleta React.
//
// Uso: node scripts/generate-glyphs.mjs   (el resultado se versiona; solo hay que volver a ejecutarlo
// si cambian los iconos del catálogo).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const lucideRoot = path.dirname(require.resolve("lucide-react/package.json"));

// Mismos nombres que `icon` en packages/shared/src/entity-catalog.ts
const ICONS = ["user", "home", "car", "phone", "at-sign", "building", "landmark", "file-text", "map-pin", "circle-help"];

const num = (v) => Number(v);

function toPath(tag, a) {
  switch (tag) {
    case "path":
      return a.d;
    case "circle": {
      const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)];
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case "rect": {
      const [x, y, w, h] = [num(a.x ?? 0), num(a.y ?? 0), num(a.width), num(a.height)];
      const r = Math.min(num(a.rx ?? a.ry ?? 0), w / 2, h / 2);
      if (!r) return `M${x} ${y}h${w}v${h}h${-w}z`;
      return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
    }
    case "line":
      return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case "polyline":
    case "polygon": {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? `${d}z` : d;
    }
    default:
      throw new Error(`Elemento SVG no soportado: ${tag}`);
  }
}

// Alias de lucide: el nombre del catálogo → archivo real que contiene los datos.
const FILE_FOR = { home: "house", "circle-help": "circle-question-mark" };

const out = {};
for (const name of ICONS) {
  const file = FILE_FOR[name] ?? name;
  const mod = await import(pathToFileURL(path.join(lucideRoot, "dist", "esm", "icons", `${file}.mjs`)).href);
  const data = mod.__iconData;
  if (!data?.node) throw new Error(`Icono sin datos: ${name}`);
  out[name] = data.node.map(([tag, attrs]) => toPath(tag, attrs)).join("");
}

const body =
  `// ARCHIVO GENERADO por scripts/generate-glyphs.mjs a partir de lucide (ISC). No editar a mano.\n` +
  `/** Rutas SVG (viewBox 24x24, para trazar con lineWidth 2) por nombre de icono del catálogo. */\n` +
  `export const GLYPH_PATHS: Readonly<Record<string, string>> = ${JSON.stringify(out, null, 2)};\n`;

const target = path.resolve(import.meta.dirname, "../src/features/editor/glyphs.generated.ts");
writeFileSync(target, body, "utf8");
console.log(`Generado ${path.relative(process.cwd(), target)} con ${ICONS.length} glifos`);
