const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
const numberFmt = new Intl.NumberFormat("es");

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "hace 3 horas", "ayer"... Para fechas futuras o muy recientes devuelve "ahora". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "ahora";
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), "minute");
}

/** Resumen legible del user-agent SIN guardarlo ni enviarlo a terceros: solo navegador y sistema. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Dispositivo desconocido";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "sistema desconocido";
  return `${browser} en ${os}`;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "1,4 MB", "230 KB"... (base 1024, con coma decimal en español). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat("es", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}
