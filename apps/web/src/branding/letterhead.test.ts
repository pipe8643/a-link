import { describe, expect, it } from "vitest";
import { letterheadFitSize } from "./letterhead";

describe("letterheadFitSize", () => {
  it("no agranda una imagen que ya cabe", () => {
    expect(letterheadFitSize(1920, 1080, 4096)).toEqual({ width: 1920, height: 1080 });
  });

  it("reduce el lado largo al tope y mantiene la proporción", () => {
    expect(letterheadFitSize(7680, 4320, 4096)).toEqual({ width: 4096, height: 2304 });
  });
});
