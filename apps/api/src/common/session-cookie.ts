/**
 * Forma de un token de sesión (256 bits en base64url). No sustituye a `SessionService.validate`:
 * solo evita tratar un valor basura como si fuera una cookie de sesión.
 */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Extrae el token de la cookie de sesión si el nombre coincide de forma exacta y el valor tiene la
 * forma esperada. No usa `String.includes` sobre la cabecera cruda: una cookie ajena no debe activar
 * el parser de cuerpos grandes.
 */
export function sessionTokenFromCookies(
  cookies: Record<string, unknown> | undefined,
  cookieName: string,
): string | null {
  const value = cookies?.[cookieName];
  return typeof value === "string" && SESSION_TOKEN_PATTERN.test(value) ? value : null;
}
