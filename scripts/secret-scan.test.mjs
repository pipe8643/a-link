import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findKnownSecrets, isForbiddenFile, isIgnored, parseIgnore, readKnownSecrets, scanText } from "./lib/secret-scan.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "secret-scan.mjs");
const rules = (text, rel = "apps/api/src/x.ts") => scanText(rel, text).map((f) => f.rule);

describe("scanText: detecta claves con formato conocido (también en pruebas)", () => {
  it.each([
    ["clave privada PEM", "-----BEGIN " + "RSA PRIVATE KEY-----"], // fixtures partidos para que el propio rastreo no los vea
    ["clave de acceso de AWS", "const k = 'AKI" + "AABCDEFGHIJKLMNOP';"],
    ["token de GitHub", `token: ghp_${"a1B2".repeat(10)}`],
    ["token de Slack", "xox" + "b-1234567890-abcdefghij"],
    ["clave secreta de Stripe", `sk_live_${"abcd1234".repeat(3)}`],
    ["clave de API de Google", `AIza${"A1b2C3d4E5".repeat(3)}12345`],
    ["JWT", "eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"],
  ])("%s", (rule, line) => {
    expect(rules(line)).toContain(rule);
    expect(rules(line, "apps/api/test/x.test.ts"), "las pruebas no son una excepción para claves reales").toContain(rule);
  });
});

describe("scanText: credenciales asignadas y URLs con contraseña", () => {
  it("detecta un literal con aspecto de secreto y una URL de base de datos con contraseña real", () => {
    expect(rules('const SESSION_SECRET = "a8f3k29dj4h2l9s0d7f6g5h4";')).toContain("credencial asignada en el código o la configuración");
    expect(rules("S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI7K9MDENGbPxRfiCY3xAmPlK")).toContain("credencial asignada en el código o la configuración");
    expect(rules("DATABASE_URL=mysql://app:Zk39sdf8Qw2x@db:3306/a_link")).toContain("URL de base de datos con contraseña");
  });

  it("no marca marcadores, lecturas del entorno, accesos a propiedades ni nombres de variable", () => {
    for (const line of [
      "SESSION_SECRET=CAMBIAR_POR_UN_VALOR_ALEATORIO_LARGO",
      "DATABASE_URL=mysql://alink:CONTRASENA@localhost:3306/a_link",
      "SESSION_SECRET: ${SESSION_SECRET:?Define SESSION_SECRET en .env.docker}",
      "const secret = process.env.SESSION_SECRET_VALUE_XYZ_1234;",
      "const tokenHash = this.crypto.hashToken(rawToken123);",
      "accessKeyId: e.S3_ACCESS_KEY_ID!,",
      "password: decodeURIComponent(url.password),",
      "window.ZoomChartsLicenseKey = cfg.zoomChartsLicenseKey;",
      "const PASSWORD_POLICY_NAME = passwordPolicyForAccounts;",
      "mysql://usuario:clave@host:puerto/base",
      "S3_SECRET_ACCESS_KEY=",
    ]) {
      expect(rules(line), line).toEqual([]);
    }
  });

  it("las contraseñas SINTÉTICAS de pruebas y de la demostración no cuentan, las de producción sí", () => {
    const line = 'const PASSWORD = "Una-Frase-Larga-2026x";';
    expect(rules(line, "apps/web/e2e/helpers.ts")).toEqual([]);
    expect(rules(line, "apps/api/test/helpers/test-app.ts")).toEqual([]);
    expect(rules(line, "apps/api/src/seed/seed-demo.ts")).toEqual([]);
    expect(rules(line, "apps/api/src/auth/auth.service.ts")).toContain("credencial asignada en el código o la configuración");
  });

  it("devuelve ruta y línea, pero NUNCA el valor", () => {
    const findings = scanText("a.ts", 'ok\nconst API_KEY = "zzTOPSECRETvalue1234567890";');
    expect(findings).toEqual([{ line: 2, rule: "credencial asignada en el código o la configuración" }]);
    expect(JSON.stringify(findings)).not.toContain("zzTOPSECRET");
  });
});

describe("valores secretos reales de los ficheros de entorno locales", () => {
  it("se detectan en cualquier fichero y solo se devuelve el NOMBRE de la variable", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alink-scan-"));
    try {
      const env = path.join(dir, ".env");
      writeFileSync(env, ["SESSION_SECRET=valor-real-de-sesion-8f3k29dj", "DATABASE_URL=mysql://app:ClaveReal-9d8s7f6@db/a", "API_PORT=3000", "MAIL_DIR=./x", "DB_PASSWORD=corta"].join("\n"));
      const known = readKnownSecrets(env);
      expect(known.map((k) => k.name).sort()).toEqual(["DATABASE_URL", "SESSION_SECRET"]); // solo variables sensibles y de ≥ 8 caracteres
      expect(known.find((k) => k.name === "DATABASE_URL")?.value).toBe("ClaveReal-9d8s7f6"); // de la URL solo la contraseña
      expect(findKnownSecrets("texto con valor-real-de-sesion-8f3k29dj dentro", known)).toEqual(["SESSION_SECRET"]);
      expect(findKnownSecrets("nada", known)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("los marcadores de .env.example no cuentan como secretos locales", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alink-scan-"));
    try {
      const f = path.join(dir, ".env");
      writeFileSync(f, "SESSION_SECRET=CAMBIAR_POR_UN_VALOR_ALEATORIO_LARGO\nZOOMCHARTS_LICENSE=\n");
      expect(readKnownSecrets(f)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ficheros que no deben versionarse y .gitignore", () => {
  it("marca .env, claves y certificados, pero no .env.example", () => {
    for (const f of [".env", ".env.docker", "apps/api/.env", "certs/tls.key", "certs/tls.crt", "x/server.pem", "x.p12", "secrets/a.txt", "id_rsa"]) expect(isForbiddenFile(f), f).toBe(true);
    for (const f of [".env.example", ".env.docker.example", "apps/web/src/env.ts", "docs/guia.md"]) expect(isForbiddenFile(f), f).toBe(false);
  });

  it("interpreta el .gitignore del proyecto (nombres, carpetas, comodines, negaciones)", () => {
    const r = parseIgnore(".env\n.env.*\n!.env.example\nnode_modules/\n*.pem\n/storage/\n/apps/*/storage/\napps/api/src/generated/\n");
    const ign = (p, dir = false) => isIgnored(r, p, dir);
    expect(ign(".env")).toBe(true);
    expect(ign(".env.docker")).toBe(true);
    expect(ign(".env.example")).toBe(false);
    expect(ign("node_modules", true)).toBe(true);
    expect(ign("apps/api/node_modules/x/y.js")).toBe(true);
    expect(ign("certs/a.pem")).toBe(true);
    expect(ign("apps/api/storage/e2e-files/f", false)).toBe(true);
    expect(ign("storage/x", false)).toBe(true);
    expect(ign("apps/api/src/storage/storage.service.ts")).toBe(false); // los datos se ignoran por ruta anclada; el código en src/storage SÍ se versiona
    expect(ign("apps/api/src/generated/prisma/client.ts")).toBe(true);
    expect(ign("apps/api/src/app.module.ts")).toBe(false);
  });
});

describe("el script completo", () => {
  const run = (root, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, SECRET_SCAN_ROOT: root }, encoding: "utf8" });

  it("falla (código 1) y no imprime el secreto cuando un valor real de .env está escrito en un fichero versionable", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alink-scan-"));
    try {
      const secret = "Zq81-secreto-que-no-debe-salir-77";
      writeFileSync(path.join(dir, ".gitignore"), ".env\nnode_modules/\n");
      writeFileSync(path.join(dir, ".env"), `SESSION_SECRET=${secret}\n`);
      mkdirSync(path.join(dir, "src"));
      writeFileSync(path.join(dir, "src", "config.ts"), `// copiado por error\nexport const s = "${secret}";\n`);
      const res = run(dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("src/config.ts");
      expect(res.stderr).toContain("SESSION_SECRET");
      expect(res.stdout + res.stderr).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falla si hay un .env que NO está en .gitignore o una clave privada versionable, y pasa con un árbol limpio", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alink-scan-"));
    try {
      writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
      writeFileSync(path.join(dir, "README.md"), "# limpio\n");
      expect(run(dir).status).toBe(0);
      writeFileSync(path.join(dir, ".env"), "API_PORT=3000\n");
      const leaked = run(dir);
      expect(leaked.status).toBe(1);
      expect(leaked.stderr).toMatch(/\.env.*(no debe versionarse|NO está en \.gitignore)/);
      rmSync(path.join(dir, ".env"));
      writeFileSync(path.join(dir, "cert.txt"), "-----BEGIN " + "PRIVATE KEY-----\nabc\n");
      expect(run(dir).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("el repositorio real está limpio", () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
  });
});
