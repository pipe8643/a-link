/**
 * Enlaces de solo lectura. El token viaja en el FRAGMENTO de la URL (`/s#<token>`): los navegadores no envían el
 * fragmento al servidor, así que no queda en registros de acceso, ni en el encabezado `Referer`; la página lo lee y lo
 * envía en la cabecera `X-Share-Token`.
 */
export const SHARE_TOKEN_HEADER = "X-Share-Token";
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_DAYS = [1, 7, 30] as const;
export type ShareDays = (typeof SHARE_DAYS)[number];
export const SHARE_DAYS_LABELS: Readonly<Record<ShareDays, string>> = { 1: "1 día", 7: "7 días", 30: "30 días" };
export const SHARE_PATH = "/s";

export const buildShareUrl = (origin: string, token: string): string => `${origin}${SHARE_PATH}#${token}`;

/** Copia al portapapeles. Devuelve false si el navegador lo impide (el usuario puede seleccionar el texto a mano). */
export async function copyShareUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/** Extrae el token de un fragmento (`#abc…`). Devuelve `null` si no tiene el formato esperado. */
export function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return SHARE_TOKEN_PATTERN.test(raw) ? raw : null;
}

export type ShareStatus = "active" | "expired" | "revoked";
export const SHARE_STATUS_LABELS: Readonly<Record<ShareStatus, string>> = { active: "Activo", expired: "Caducado", revoked: "Revocado" };
