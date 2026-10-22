import { describe, expect, it } from "vitest";
import { resetTokenFromLocation } from "./reset-token";

describe("resetTokenFromLocation", () => {
  it("prioriza el fragmento sobre la query", () => {
    expect(resetTokenFromLocation("?token=query", "#hash-token")).toBe("hash-token");
    expect(resetTokenFromLocation("", "#abc")).toBe("abc");
    expect(resetTokenFromLocation("?token=solo-query", "")).toBe("solo-query");
    expect(resetTokenFromLocation("", "")).toBe("");
  });
});
