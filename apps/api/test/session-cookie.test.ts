import { describe, expect, it } from "vitest";
import { SESSION_TOKEN_PATTERN, sessionTokenFromCookies } from "../src/common/session-cookie.js";

const NAME = "alink_sid";
const TOKEN = "A".repeat(43);

describe("sessionTokenFromCookies", () => {
  it("acepta solo el nombre exacto y un valor con forma de token", () => {
    expect(sessionTokenFromCookies({ [NAME]: TOKEN }, NAME)).toBe(TOKEN);
    expect(SESSION_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it("rechaza ausencia, nombre distinto, valor corto o caracteres inválidos", () => {
    expect(sessionTokenFromCookies(undefined, NAME)).toBeNull();
    expect(sessionTokenFromCookies({}, NAME)).toBeNull();
    expect(sessionTokenFromCookies({ other: TOKEN }, NAME)).toBeNull();
    expect(sessionTokenFromCookies({ [NAME]: "x" }, NAME)).toBeNull();
    expect(sessionTokenFromCookies({ [NAME]: `${TOKEN}extra` }, NAME)).toBeNull();
    expect(sessionTokenFromCookies({ [NAME]: "a".repeat(43) + "/" }, NAME)).toBeNull();
    expect(sessionTokenFromCookies({ [NAME]: 1 }, NAME)).toBeNull();
  });
});
