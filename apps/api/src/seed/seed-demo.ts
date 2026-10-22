import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { CryptoService } from "../auth/crypto.service.js";
import { passwordViolatesPolicy } from "../auth/auth.service.js";
import { ConfigError, loadConfig } from "../config/app-config.js";
import { loadDotenvIfDevelopment } from "../config/load-dotenv.js";
import { PrismaService } from "../db/prisma.service.js";
import { FoldersService } from "../folders/folders.service.js";
import { GraphContentService } from "../graphs/graph-content.service.js";
import { GraphsService } from "../graphs/graphs.service.js";

/**
 * Carga de datos de DEMOSTRACIÓN. Todo es sintético y ficticio: ninguna persona, empresa, cuenta ni documento
 * real. La contraseña del usuario de demostración NO está en el repositorio: se exige por entorno
 * (`DEMO_USER_PASSWORD`) y no se muestra jamás. Es idempotente: si el usuario ya existe, no toca nada.
 *
 *   docker compose --env-file .env.docker --profile seed run --rm seed
 *   npm run seed:demo -w @a-link/api      (desarrollo; usa el .env de la raíz)
 */
const MIN_PASSWORD_LENGTH = 12;

interface DemoNode {
  key: string;
  type: string;
  label: string;
  description?: string;
  tags?: string[];
  at: [number, number];
}
type DemoEdge = [from: string, to: string, type: string, label: string, evidence: "recorded" | "hypothesis" | "observation", direction?: "forward" | "both" | "none"];

const NODES: DemoNode[] = [
  { key: "ana", type: "person", label: "Ana Ejemplo", description: "Persona ficticia: administradora de Alfa S.L.", tags: ["núcleo"], at: [0, 0] },
  { key: "beto", type: "person", label: "Beto Muestra", description: "Persona ficticia: socio de Alfa S.L.", tags: ["núcleo"], at: [320, -120] },
  { key: "carla", type: "person", label: "Carla Prueba", description: "Persona ficticia: contacto frecuente de Ana.", tags: ["contacto"], at: [-300, -160] },
  { key: "dario", type: "person", label: "Darío Ficticio", description: "Persona ficticia sin relación confirmada.", tags: ["pendiente"], at: [-380, 120] },
  { key: "alfa", type: "organization", label: "Alfa S.L. (ficticia)", description: "Empresa inventada para la demostración.", tags: ["empresa"], at: [160, 160] },
  { key: "beta", type: "organization", label: "Beta Servicios (ficticia)", description: "Empresa inventada para la demostración.", tags: ["empresa"], at: [520, 120] },
  { key: "cuenta1", type: "bank_account", label: "Cuenta ES00 0000 0000 00 0000000001", description: "Cuenta inventada (no es un IBAN válido).", at: [0, 300] },
  { key: "cuenta2", type: "bank_account", label: "Cuenta ES00 0000 0000 00 0000000002", description: "Cuenta inventada (no es un IBAN válido).", at: [360, 320] },
  { key: "tel1", type: "phone", label: "+00 000 000 001", description: "Teléfono inventado.", at: [-180, 20] },
  { key: "tel2", type: "phone", label: "+00 000 000 002", description: "Teléfono inventado.", at: [-520, -20] },
  { key: "coche", type: "vehicle", label: "Vehículo 0000-AAA (ficticio)", description: "Matrícula inventada.", at: [180, -240] },
  { key: "casa", type: "property", label: "Inmueble de ejemplo", description: "Dirección ficticia.", at: [-40, -260] },
  { key: "doc", type: "document", label: "Contrato de ejemplo", description: "Documento inventado.", at: [340, 20] },
  { key: "lugar", type: "location", label: "Oficina de ejemplo", description: "Ubicación ficticia.", at: [140, 380] },
];

const EDGES: DemoEdge[] = [
  ["ana", "alfa", "ownership", "administra", "recorded"],
  ["beto", "alfa", "ownership", "socio", "recorded"],
  ["alfa", "beta", "commercial", "factura a", "recorded", "forward"],
  ["alfa", "cuenta1", "title_holder", "titular", "recorded"],
  ["beta", "cuenta2", "title_holder", "titular", "recorded"],
  ["cuenta1", "cuenta2", "commercial", "transferencias", "observation", "both"],
  ["ana", "tel1", "device_usage", "usa", "recorded"],
  ["carla", "tel1", "contact", "llamadas frecuentes", "observation", "both"],
  ["carla", "ana", "contact", "se reúnen", "observation", "both"],
  ["dario", "tel2", "device_usage", "usa", "hypothesis"],
  ["tel2", "tel1", "contact", "posible contacto", "hypothesis", "both"],
  ["ana", "coche", "ownership", "titular", "recorded"],
  ["ana", "casa", "ownership", "propietaria", "recorded"],
  ["beto", "doc", "association", "firma", "recorded"],
  ["doc", "alfa", "commercial", "contrato con", "recorded"],
  ["alfa", "lugar", "location", "sede", "recorded", "none"],
  ["dario", "beto", "association", "posible vínculo", "hypothesis", "none"],
];

async function main(): Promise<void> {
  loadDotenvIfDevelopment();
  const email = (process.env.DEMO_USER_EMAIL ?? "demo@example.test").trim().toLowerCase();
  const password = process.env.DEMO_USER_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`DEMO_USER_PASSWORD: obligatoria (mínimo ${MIN_PASSWORD_LENGTH} caracteres).`);
    process.exit(1);
  }
  if (passwordViolatesPolicy(password, email)) {
    console.error("DEMO_USER_PASSWORD: no puede contener la parte local del correo.");
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.createApplicationContext(AppModule.register(config), { logger: ["error", "warn"] });
  try {
    const db = app.get(PrismaService, { strict: false }).client;
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      console.log("El usuario de demostración ya existe: no se cambia nada.");
      return;
    }
    const crypto = app.get(CryptoService, { strict: false });
    // Se crea directamente (no por el registro público): funciona aunque REGISTRATION_ENABLED=false.
    const user = await db.user.create({
      data: { email, passwordHash: await crypto.hashPassword(password), displayName: "Usuario de demostración" },
      select: { id: true },
    });
    const folder = await app.get(FoldersService, { strict: false }).create(user.id, { name: "Demostración" });
    const graph = await app.get(GraphsService, { strict: false }).create(user.id, {
      name: "Red de ejemplo (datos sintéticos)",
      description: "Datos inventados para probar A-Link. Ninguna persona, empresa ni cuenta es real.",
      folderId: folder.id,
    });

    const ids = new Map(NODES.map((n) => [n.key, randomUUID()]));
    const nodes = NODES.map((n) => ({
      id: ids.get(n.key)!,
      type: n.type,
      label: n.label,
      description: n.description ?? "",
      notes: "",
      tags: n.tags ?? [],
      metadata: {},
      positionX: n.at[0],
      positionY: n.at[1],
    }));
    const edges = EDGES.map(([from, to, type, label, evidenceClass, direction]) => ({
      id: randomUUID(),
      sourceId: ids.get(from)!,
      targetId: ids.get(to)!,
      relationshipType: type,
      label,
      metadata: { direction: direction ?? "forward", evidenceClass },
    }));
    await app.get(GraphContentService, { strict: false }).save(user.id, graph.id, { expectedRevision: 1, nodes, edges });
    console.log(`Demostración creada: usuario ${email}, 1 carpeta, 1 grafo (${nodes.length} entidades, ${edges.length} relaciones).`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  // Sin volcar el error completo: podría incluir la cadena de conexión.
  console.error("Error al cargar la demostración:", err instanceof Error ? err.message.split("\n")[0] : "desconocido");
  process.exit(1);
});
