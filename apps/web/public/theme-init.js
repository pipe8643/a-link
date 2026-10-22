// Aplica el tema guardado (o el del sistema) antes de pintar, para evitar el parpadeo.
// Es un fichero propio (no inline) para poder mantener una CSP con script-src 'self'.
try {
  var stored = localStorage.getItem("alink-theme");
  var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {
  /* sin acceso a localStorage: se queda el tema claro */
}
