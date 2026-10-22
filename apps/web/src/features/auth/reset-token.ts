/**
 * El enlace de recuperación lleva el token en el fragmento (`/reset-password#token`) para que no
 * viaje en registros, Referer ni clientes de correo que reescriben la query. Se admite `?token=`
 * como compatibilidad con correos antiguos.
 */
export function resetTokenFromLocation(search: string, hash: string): string {
  const rawHash = (hash.startsWith("#") ? hash.slice(1) : hash).trim();
  if (rawHash) {
    try {
      return decodeURIComponent(rawHash);
    } catch {
      return rawHash;
    }
  }
  return new URLSearchParams(search).get("token") ?? "";
}
