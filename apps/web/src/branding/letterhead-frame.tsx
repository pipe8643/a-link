import { LETTERHEAD_INSET } from "./letterhead";

interface Props {
  children: React.ReactNode;
  /** URL del membrete personal; si falta, el visor queda en blanco. */
  src?: string | null;
}

/**
 * Fondo del visor HTML (PowerPoint Web Viewer): si hay imagen se estira al 100% del marco
 * (`object-fit: fill`), sin recorte ni compresión extra.
 */
export function LetterheadFrame({ children, src }: Props) {
  return (
    <div className="relative h-dvh overflow-hidden bg-white text-slate-900">
      {src ? (
        <img
          src={src}
          alt=""
          decoding="sync"
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-fill select-none"
        />
      ) : null}
      <div
        className="absolute z-10 flex min-h-0 flex-col"
        style={
          src
            ? {
                left: `${LETTERHEAD_INSET.left * 100}%`,
                right: `${LETTERHEAD_INSET.right * 100}%`,
                top: `${LETTERHEAD_INSET.top * 100}%`,
                bottom: `${LETTERHEAD_INSET.bottom * 100}%`,
              }
            : { inset: 0 }
        }
      >
        {children}
      </div>
    </div>
  );
}
