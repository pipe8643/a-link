import { ENTITY_CATALOG, type EntityTypeId } from "@a-link/shared";
import { GLYPH_PATHS } from "./glyphs.generated";
import { SHAPES } from "./shapes";

/** Miniatura SVG de un tipo de entidad, con la MISMA geometría y glifo que el lienzo (paleta y listas coherentes). */
export function ShapeIcon({ type, size = 28, className }: { type: EntityTypeId; size?: number; className?: string }) {
  const def = ENTITY_CATALOG[type];
  const geo = SHAPES[def.shape];
  const hw = geo.hwFactor;
  const hh = geo.hhFactor;
  const points = geo.outline.map(([x, y]) => `${(x * hw).toFixed(3)},${(y * hh).toFixed(3)}`).join(" ");
  const glyph = def.icon ? GLYPH_PATHS[def.icon] : undefined;
  const half = Math.min(hw, hh) * geo.glyphScale;
  const s = (half * 2) / 24;
  const gx = geo.glyphCenter[0] * hw - 12 * s;
  const gy = geo.glyphCenter[1] * hh - 12 * s;
  return (
    <svg viewBox="-1.5 -1.5 3 3" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <polygon
        points={points}
        fill={def.defaultColor}
        stroke="rgba(0,0,0,0.3)"
        strokeWidth={0.07}
        strokeLinejoin="round"
        strokeDasharray={geo.dashed ? "0.22 0.16" : undefined}
      />
      {glyph ? (
        <g transform={`translate(${gx} ${gy}) scale(${s})`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={glyph} />
        </g>
      ) : null}
    </svg>
  );
}
