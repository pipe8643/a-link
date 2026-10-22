import { describe, expect, it, vi } from "vitest";
import { SHARE_TOKEN_PATTERN, buildShareUrl, copyShareUrl, tokenFromHash } from "./share-link";

const TOKEN = "A".repeat(43);

describe("enlaces de solo lectura", () => {
  it("arma la URL con el token en el fragmento (no en la ruta)", () => {
    expect(buildShareUrl("https://app.example", TOKEN)).toBe(`https://app.example/s#${TOKEN}`);
    expect(SHARE_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it("acepta un fragmento válido y rechaza basura", () => {
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(TOKEN)).toBe(TOKEN);
    expect(tokenFromHash("#corto")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash(`#${TOKEN}extra`)).toBeNull();
  });

  it("copyShareUrl no lanza si el portapapeles no está disponible", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyShareUrl("https://x/s#y")).toBe(false);
    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    expect(await copyShareUrl("https://x/s#y")).toBe(true);
    vi.unstubAllGlobals();
  });
});
