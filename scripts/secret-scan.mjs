#!/usr/bin/env node
// Rastreo de secretos del repositorio (criterio 18). Uso:
//   node scripts/secret-scan.mjs            árbol versionable (ficheros no ignorados por .gitignore)
//   node scripts/secret-scan.mjs --images   además, las imágenes de Docker locales (a-link-api/web/migrate:local)
//
// Comprueba:
//   1. Ficheros que no deben versionarse (.env, claves privadas, certificados) fuera de .gitignore.
//   2. Claves con formato conocido (PEM, AWS, GitHub, Slack, Stripe, Google, JWT), URLs con contraseña y
//      credenciales asignadas en código/configuración.
//   3. Los valores SECRETOS REALES de tu .env, .env.docker... NO aparecen en ningún fichero versionable.
//   4. (--images) Ni esos valores ni ficheros .env están dentro de las imágenes.
// Nunca imprime un secreto: solo ruta, línea y regla. Sale con código 1 si encuentra algo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findKnownSecrets, isForbiddenFile, parseIgnore, readKnownSecrets, readTextFile, scanText, walkVersionable } from "./lib/secret-scan.mjs";

// SECRET_SCAN_ROOT solo lo usan las pruebas del propio rastreo (un árbol temporal).
const ROOT = process.env.SECRET_SCAN_ROOT ? path.resolve(process.env.SECRET_SCAN_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withImages = process.argv.includes("--images");

const ignoreRules = parseIgnore(existsSync(path.join(ROOT, ".gitignore")) ? readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "");
const envFiles = [".env", ".env.docker", ".env.docker.test"].map((f) => path.join(ROOT, f));
const known = envFiles.flatMap((f) => readKnownSecrets(f));
const findings = [];
let scanned = 0;

for (const { abs, rel, ignored } of walkVersionable(ROOT, ignoreRules)) {
  if (ignored) continue; // no se versiona: no es una fuga del repositorio
  scanned++;
  if (isForbiddenFile(rel)) findings.push(`${rel}: fichero que no debe versionarse`);
  const text = readTextFile(abs);
  if (text === null) continue;
  for (const f of scanText(rel, text)) findings.push(`${rel}:${f.line}: ${f.rule}`);
  for (const name of findKnownSecrets(text, known)) findings.push(`${rel}: contiene el valor real de ${name} (de tu fichero de entorno local)`);
}

// Los ficheros .env locales deben estar ignorados (si no, un `git add .` los subiría).
for (const f of [".env", ".env.docker", ".env.docker.test"]) {
  if (existsSync(path.join(ROOT, f)) && !ignoredRel(f)) findings.push(`${f}: existe y NO está en .gitignore`);
}
function ignoredRel(rel) {
  return walkIgnored(rel);
}
function walkIgnored(rel) {
  // Reutiliza el intérprete de .gitignore para un fichero concreto.
  return ignoreRules.length > 0 && ignoreRules.some((r) => r.regex.test(rel)) && !ignoreRules.some((r) => r.negate && r.regex.test(rel));
}

if (withImages) {
  const IMAGES = ["a-link-api:local", "a-link-web:local", "a-link-migrate:local"];
  const docker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const image of IMAGES) {
    try {
      docker(["image", "inspect", image]);
    } catch {
      findings.push(`${image}: la imagen no existe (construye con docker compose build)`);
      continue;
    }
    // 1) Sin ficheros de entorno ni claves dentro de la imagen.
    const files = docker(["run", "--rm", "--entrypoint", "sh", image, "-c", "find / -xdev \\( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name 'id_rsa' \\) -not -path '/proc/*' -not -path '*/node_modules/*' -not -path '/etc/ssl*' -not -path '/usr/lib/ssl/*' -not -path '/usr/share/*' 2>/dev/null; true"]).trim();
    if (files) findings.push(`${image}: contiene ficheros sensibles: ${files.split("\n").join(", ")}`);
    // 2) Ninguno de los valores secretos locales está en la imagen. El valor viaja por entorno (no en la línea de comandos).
    for (const { name, value } of known) {
      const out = docker(["run", "--rm", "--entrypoint", "sh", "-e", `NEEDLE=${value}`, image, "-c", 'grep -rIlF -e "$NEEDLE" / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null | grep -v "^/proc" | head -3; true']).trim();
      if (out) findings.push(`${image}: contiene el valor real de ${name} en ${out.split("\n").join(", ")}`);
    }
  }
}

console.log(`Rastreo de secretos: ${scanned} ficheros versionables revisados${withImages ? " + imágenes de Docker" : ""}; ${known.length} valores secretos locales usados como referencia.`);
if (findings.length) {
  console.error(`\n${findings.length} hallazgo(s):`);
  for (const f of findings) console.error(` - ${f}`);
  process.exit(1);
}
console.log("Sin hallazgos.");
