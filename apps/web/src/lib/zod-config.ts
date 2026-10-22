import { z } from "zod";

/**
 * Zod 4 intenta compilar sus validadores con `new Function`. Con una CSP estricta (sin `'unsafe-eval'`, como la de
 * producción) esa sonda falla en silencio pero el navegador la registra como infracción. Con `jitless` se desactiva
 * la compilación y la sonda: los validadores usan el camino interpretado, con el mismo resultado.
 *
 * Debe importarse PRIMERO en `main.tsx`: los esquemas se construyen al cargar sus módulos y deciden entonces.
 */
z.config({ jitless: true });
