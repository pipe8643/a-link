// Lógica del rastreo de secretos (sin dependencias). El script `scripts/secret-scan.mjs` la usa y las pruebas la ejercitan.
// REGLA: nunca se imprime un secreto, ni siquiera parcialmente; solo ruta, línea y nombre de la regla.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Carpetas que nunca se recorren (dependencias, artefactos, datos privados, resultados de pruebas). */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "storage", ".storage", "test-results", "test-results-stack", "playwright-report", "playwright-report-stack", ".vitest-cache", "certs", ".cursor", ".vscode"]);
/** Código generado: se recrea en cada build y no se versiona. */
const SKIP_PATHS = [/(^|\/)apps\/api\/src\/generated(\/|$)/, /(^|\/)package-lock\.json$/];

/** Ficheros que, por su sola presencia en el árbol versionable, son una fuga. */
const FORBIDDEN_FILES = [/(^|\/)\.env(\..+)?$/, /\.pem$/, /\.key$/, /\.crt$/, /\.cer$/, /\.p12$/, /\.pfx$/, /(^|\/)id_(rsa|ed25519|ecdsa)$/, /(^|\/)secrets(\/|$)/, /(^|\/)certs(\/|$)/];
const ALLOWED_FILES = [/(^|\/)\.env(\.[a-z]+)?\.example$/];

/** Valores que son claramente marcadores o datos sintéticos de prueba. */
const PLACEHOLDER = /(CAMBIAR|CONTRASENA|CHANGE_?ME|PLACEHOLDER|EXAMPLE|example\.test|xxxx|\$\{|<[^>]+>|\.\.\.|tu[-_ ]?(clave|licencia|secreto)|sin valor|aleatori|usuario:clave|usuario:contrase)/i;
/** En pruebas y datos de demostración es normal que haya contraseñas SINTÉTICAS: solo se vigilan las claves con formato conocido. */
const TEST_PATH = /(^|\/)(test|tests|e2e|e2e-stack|__tests__)(\/|$)|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|(^|\/)seed\//;

/** [nombre, expresión, solo fuera de pruebas, validación opcional del valor capturado] */
export const RULES = [
  ["clave privada PEM", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/, false],
  ["clave de acceso de AWS", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, false],
  ["token de GitHub", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, false],
  ["token de Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, false],
  ["clave secreta de Stripe", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/, false],
  ["clave de API de Google", /\bAIza[0-9A-Za-z_-]{35}\b/, false],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, false],
  ["URL de base de datos con contraseña", /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@'"]+:([^\s@'"]{4,})@/, true],
  // Un literal ("...", '...') o, en ficheros de entorno, el resto de la línea sin espacios. Los accesos a propiedades
  // (a.b.c), llamadas y nombres de variable no son valores. Debe parecer aleatorio: letras y dígitos.
  [
    "credencial asignada en el código o la configuración",
    /\b[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|LICENSE_?KEY|ACCESS_?KEY)[A-Za-z0-9_]*\s*[:=]\s*(?:"([^"\s]{16,})"|'([^'\s]{16,})'|([A-Za-z0-9+/_=-]{16,})\s*$)/i,
    true,
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
  ],
];

/** ¿Es un valor de marcador? (si lo es, no se considera fuga) */
export function isPlaceholder(value) {
  return PLACEHOLDER.test(value);
}

/** Busca fugas en el TEXTO de un fichero. Devuelve `{ line, rule }` (nunca el valor). */
export function scanText(relPath, text) {
  const findings = [];
  const isTest = TEST_PATH.test(relPath);
  const lines = text.split(/\r?\n/);
  lines.forEach((content, i) => {
    if (content.length > 5000) return; // minificados / datos: no son configuración escrita a mano
    for (const [rule, regex, productionOnly, validate] of RULES) {
      if (productionOnly && isTest) continue;
      const m = regex.exec(content);
      if (!m) continue;
      const value = m[1] ?? m[2] ?? m[3] ?? m[0];
      if (validate && !validate(value)) continue;
      if (productionOnly && isPlaceholder(content)) continue;
      // Lecturas del entorno (process.env.X, ${X}) o referencias a variables no son valores.
      if (productionOnly && /process\.env|import\.meta\.env|\$\{?[A-Z_]+\}?/.test(value)) continue;
      findings.push({ line: i + 1, rule });
    }
  });
  return findings;
}

/** Comprueba si el texto contiene alguno de los valores secretos CONOCIDOS (locales). Devuelve los nombres de las claves. */
export function findKnownSecrets(text, known) {
  return known.filter(({ value }) => text.includes(value)).map(({ name }) => name);
}

/** Variables cuyo valor es secreto y no debe aparecer en ningún sitio versionable. */
const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|LICENSE|ACCESS_KEY|DATABASE_URL)/i;

/** Lee un fichero de entorno SIN devolver nada que no sean pares (nombre, valor) de variables sensibles. */
export function readKnownSecrets(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, name, raw] = m;
    if (!SECRET_NAME.test(name)) continue;
    let value = raw.trim().replace(/^["']|["']$/g, "");
    // De una URL de conexión solo es secreta la contraseña.
    if (/^[a-z]+:\/\//i.test(value)) {
      const pw = /:\/\/[^:/@]+:([^@]+)@/.exec(value)?.[1];
      value = pw ? decodeURIComponent(pw) : "";
    }
    if (value.length >= 8 && !isPlaceholder(value)) out.push({ name, value });
  }
  return out;
}

/** Interpreta un .gitignore sencillo: nombres, carpetas (`dir/`), `*.ext`, rutas ancladas y negaciones. */
export function parseIgnore(text) {
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    const pattern = line.replace(/\/$/, "");
    const anchored = pattern.includes("/") && !pattern.startsWith("**/");
    const source = pattern
      .replace(/^\*\*\//, "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*")
      .replace(/\?/g, "[^/]");
    rules.push({ negate, dirOnly, regex: new RegExp(anchored ? `^${source.replace(/^\//, "")}$` : `(^|/)${source}$`) });
  }
  return rules;
}

export function isIgnored(rules, relPath, isDir) {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) {
      // `dir/` también ignora todo lo que haya dentro.
      const parts = relPath.split("/");
      const inside = parts.some((_, i) => i < parts.length - 1 && r.regex.test(parts.slice(0, i + 1).join("/")));
      if (inside) ignored = !r.negate;
      continue;
    }
    if (r.regex.test(relPath)) ignored = !r.negate;
  }
  return ignored;
}

const toPosix = (p) => p.split(path.sep).join("/");

/** Recorre el árbol VERSIONABLE (lo que no ignora .gitignore ni está en las carpetas de artefactos). */
export function* walkVersionable(root, ignoreRules) {
  function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(ignoreRules, rel, true)) continue;
        yield* walk(abs);
      } else if (entry.isFile()) {
        if (SKIP_PATHS.some((re) => re.test(rel))) continue;
        // Un fichero prohibido es una fuga aunque esté en .gitignore SOLO si estuviera versionable; los ignorados no cuentan.
        const ignored = isIgnored(ignoreRules, rel, false);
        yield { abs, rel, ignored };
      }
    }
  }
  yield* walk(root);
}

export function isForbiddenFile(rel) {
  return FORBIDDEN_FILES.some((re) => re.test(rel)) && !ALLOWED_FILES.some((re) => re.test(rel));
}

/** Lee un fichero como texto; devuelve null si es binario o demasiado grande. */
export function readTextFile(abs, maxBytes = 2_000_000) {
  const { size } = statSync(abs);
  if (size > maxBytes) return null;
  const buf = readFileSync(abs);
  if (buf.subarray(0, 4096).includes(0)) return null;
  return buf.toString("utf8");
}
