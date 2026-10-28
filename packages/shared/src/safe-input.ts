/**
 * Validación de entrada compartida (XSS / esquemas peligrosos).
 *
 * Las etiquetas y notas se tratan como TEXTO (React las escapa; ZoomCharts las pinta en canvas).
 * Las URLs sí pueden convertirse en `href`: aquí se admite solo http(s) sin credenciales.
 */

const CONTROL_OR_SPACE = /[\u0000-\u001f\u007f\s]/;

/**
 * Devuelve true si `value` está vacío o es una URL `http:`/`https:` utilizable como enlace.
 * Rechaza `javascript:`, `data:`, `file:`, credenciales en la URL y caracteres de control.
 */
export function isSafeHttpUrl(value: string): boolean {
  if (value === "") return true;
  if (CONTROL_OR_SPACE.test(value)) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username !== "" || u.password !== "") return false;
    return u.hostname !== "";
  } catch {
    return false;
  }
}
