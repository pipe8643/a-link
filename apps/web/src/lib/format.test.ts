import { describe, expect, it } from "vitest";
import { describeUserAgent, formatBytes, formatRelative, pluralize } from "./format";

const NOW = new Date("2026-10-19T12:00:00Z").getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("formatRelative", () => {
  it("muy reciente → ahora (también fechas futuras por desfase de reloj)", () => {
    expect(formatRelative(ago(5), NOW)).toBe("ahora");
    expect(formatRelative(new Date(NOW + 10_000).toISOString(), NOW)).toBe("ahora");
  });
  it("minutos, horas, días", () => {
    expect(formatRelative(ago(5 * 60), NOW)).toMatch(/5 minutos/);
    expect(formatRelative(ago(3 * 3600), NOW)).toMatch(/3 horas/);
    expect(formatRelative(ago(2 * 86400), NOW)).toMatch(/anteayer|2 días/);
  });
});

describe("describeUserAgent", () => {
  it("resume navegador y sistema sin conservar el user-agent completo", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120")).toBe("Edge en Windows");
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0")).toBe("Firefox en macOS");
    expect(describeUserAgent(null)).toBe("Dispositivo desconocido");
  });
});

describe("pluralize", () => {
  it("singular y plural", () => {
    expect(pluralize(1, "entidad", "entidades")).toBe("1 entidad");
    expect(pluralize(0, "entidad", "entidades")).toBe("0 entidades");
    expect(pluralize(1500, "relación", "relaciones")).toMatch(/1\.?500 relaciones/);
  });
});

describe("formatBytes", () => {
  it("usa la unidad adecuada con coma decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(230 * 1024)).toBe("230 KB");
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1,4 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });
});