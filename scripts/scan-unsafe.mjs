#!/usr/bin/env node
// Rastreo de patrones inseguros en el código de aplicación (SQL crudo y XSS DOM).
// Uso: node scripts/scan-unsafe.mjs
// No imprime el fragmento coincidente (puede ser largo): solo ruta, línea y regla. Sale con 1 si hay hallazgos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.UNSAFE_SCAN_ROOT
  ? path.resolve(process.env.UNSAFE_SCAN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOTS = ["apps/api/src", "apps/web/src", "packages"];
const SKIP_DIR = new Set(["node_modules", "dist", "generated", "coverage"]);
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|js|mjs)$/;
const CODE_FILE = /\.(ts|tsx|js|mjs)$/;

/** @typedef {{ rule: string, re: RegExp }} Rule */
export const RULES = [
  { rule: "Prisma $queryRawUnsafe (inyección SQL)", re: /\$queryRawUnsafe\s*\(/ },
  { rule: "Prisma $executeRawUnsafe (inyección SQL)", re: /\$executeRawUnsafe\s*\(/ },
  { rule: "dangerouslySetInnerHTML (XSS)", re: /dangerouslySetInnerHTML/ },
  { rule: "asignación a innerHTML (XSS)", re: /\.innerHTML\s*=/ },
  { rule: "eval() (ejecución de código)", re: /\beval\s*\(/ },
  { rule: "new Function() (ejecución de código)", re: /\bnew\s+Function\s*\(/ },
  { rule: "document.write (XSS)", re: /document\.write\s*\(/ },
];

/**
 * @param {string} rel
 * @param {string} text
 * @returns {Array<{ line: number, rule: string }>}
 */
export function scanText(rel, text) {
  void rel;
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*") || line.trimStart().startsWith("/*")) continue;
    for (const { rule, re } of RULES) {
      re.lastIndex = 0;
      if (re.test(line)) findings.push({ line: i + 1, rule });
    }
  }
  return findings;
}

function walk(absDir, relDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith(".")) continue;
    const abs = path.join(absDir, e.name);
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "test" || e.name === "__tests__") continue;
      walk(abs, rel, out);
      continue;
    }
    if (!e.isFile() || SKIP_FILE.test(e.name) || !CODE_FILE.test(e.name)) continue;
    if (statSync(abs).size > 1_000_000) continue;
    out.push({ abs, rel: rel.replaceAll("\\", "/") });
  }
}

function main() {
  const files = [];
  for (const r of ROOTS) walk(path.join(ROOT, r), r, files);
  const findings = [];
  for (const f of files) {
    const text = readFileSync(f.abs, "utf8");
    for (const hit of scanText(f.rel, text)) findings.push(`${f.rel}:${hit.line}: ${hit.rule}`);
  }
  if (findings.length > 0) {
    console.error(`Patrones inseguros (${findings.length}):`);
    for (const line of findings) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Sin patrones inseguros de SQL/XSS en ${files.length} ficheros de aplicación.`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
