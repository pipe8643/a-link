import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { ConfigError, loadConfig } from "../src/config/app-config.js";
import { createStorage } from "../src/storage/create-storage.js";
import { LocalDiskStorage } from "../src/storage/local-disk-storage.js";
import { S3Storage } from "../src/storage/s3-storage.js";
import { StorageNotFoundError, type StorageService, isValidStorageKey } from "../src/storage/storage.service.js";

async function read(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

const owner = () => randomUUID();
const newKey = (ownerId = owner()) => `exports/${ownerId}/${randomUUID()}`;

/** Contrato común: cualquier adaptador debe comportarse igual. */
function contract(name: string, make: () => Promise<{ storage: StorageService; cleanup(): Promise<void> | void }>) {
  describe(name, () => {
    let storage: StorageService;
    let cleanup: () => Promise<void> | void;
    beforeAll(async () => {
      ({ storage, cleanup } = await make());
    });
    afterAll(async () => {
      await cleanup();
    });

    it("guarda, lee, comprueba y borra", async () => {
      const key = newKey();
      const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
      expect(await storage.exists(key)).toBe(false);
      await storage.put(key, data, "image/png");
      expect(await storage.exists(key)).toBe(true);
      const { stream, size } = await storage.get(key);
      expect(size).toBe(data.length);
      expect((await read(stream)).equals(data)).toBe(true);
      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it("sustituir un objeto deja solo el contenido nuevo", async () => {
      const key = newKey();
      await storage.put(key, Buffer.from("uno"), "application/pdf");
      await storage.put(key, Buffer.from("dos!"), "application/pdf");
      expect((await read((await storage.get(key)).stream)).toString()).toBe("dos!");
    });

    it("leer algo que no existe lanza StorageNotFoundError; borrarlo no es un error", async () => {
      const key = newKey();
      await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
      await expect(storage.delete(key)).resolves.toBeUndefined();
    });

    it.each(["../fuera", "exports/../../etc/passwd", "exports/a/b", "/etc/passwd", "exports/x/../y", `exports/${randomUUID()}/..%2f..%2fx`, "", `exports/${randomUUID()}/${randomUUID()}/extra`, `exports\\${randomUUID()}\\${randomUUID()}`])(
      "rechaza la clave no generada por el servidor %j (path traversal)",
      async (key) => {
        expect(isValidStorageKey(key)).toBe(false);
        await expect(storage.put(key, Buffer.from("x"), "image/png")).rejects.toThrow(/no válida/);
        await expect(storage.get(key)).rejects.toThrow(/no válida/);
        await expect(storage.delete(key)).rejects.toThrow(/no válida/);
        await expect(storage.exists(key)).rejects.toThrow(/no válida/);
      },
    );
  });
}

contract("LocalDiskStorage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alink-disk-"));
  return { storage: new LocalDiskStorage(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
});

describe("LocalDiskStorage: detalles propios del disco", () => {
  it("no deja temporales y las claves se reparten por propietario dentro de la raíz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alink-disk-"));
    try {
      const storage: StorageService = new LocalDiskStorage(dir);
      const ownerId = owner();
      const key = newKey(ownerId);
      await storage.put(key, Buffer.from("contenido"), "image/png");
      expect(readdirSync(join(dir, "exports"))).toEqual([ownerId]);
      expect(readdirSync(join(dir, "exports", ownerId)).every((f) => !f.endsWith(".tmp"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un fallo al escribir no deja un temporal ni el objeto a medias", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alink-disk-"));
    try {
      const storage: StorageService = new LocalDiskStorage(dir);
      const ownerId = owner();
      // Un FICHERO donde debería haber un directorio hace fallar mkdir/escritura.
      mkdirSync(join(dir, "exports"));
      writeFileSync(join(dir, "exports", ownerId), "no soy un directorio");
      await expect(storage.put(newKey(ownerId), Buffer.from("x"), "image/png")).rejects.toThrow();
      expect(readdirSync(join(dir, "exports"))).toEqual([ownerId]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createStorage elige el adaptador según la configuración", () => {
    const dir = mkdtempSync(join(tmpdir(), "alink-disk-"));
    try {
      expect(createStorage({ driver: "local", localDir: dir })).toBeInstanceOf(LocalDiskStorage);
      expect(createStorage({ driver: "s3", endpoint: "http://127.0.0.1:1", region: "us-east-1", bucket: "bucket-x", accessKeyId: "a", secretAccessKey: "b" })).toBeInstanceOf(S3Storage);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Servidor S3 mínimo en memoria (PUT/GET/HEAD/DELETE con direccionamiento por ruta). NO es MinIO: ver docs/09. */
function startFakeS3(bucket: string) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const requests: Array<{ method: string; path: string; authorization: string | undefined }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://fake").pathname);
      requests.push({ method: req.method ?? "", path, authorization: req.headers.authorization });
      const prefix = `/${bucket}/`;
      if (!path.startsWith(prefix) || !req.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) {
        res.writeHead(403, { "content-type": "application/xml" }).end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }
      const key = path.slice(prefix.length);
      const found = objects.get(key);
      switch (req.method) {
        case "PUT":
          objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "") });
          res.writeHead(200, { etag: '"fake"' }).end();
          return;
        case "GET":
          if (!found) {
            res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code><Message>no existe</Message></Error>");
            return;
          }
          res.writeHead(200, { "content-length": found.body.length, "content-type": found.type }).end(found.body);
          return;
        case "HEAD":
          res.writeHead(found ? 200 : 404, found ? { "content-length": found.body.length } : {}).end();
          return;
        case "DELETE":
          objects.delete(key);
          res.writeHead(204).end();
          return;
        default:
          res.writeHead(405).end();
      }
    });
  });
  return new Promise<{ endpoint: string; objects: typeof objects; requests: typeof requests; close(): Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ endpoint: `http://127.0.0.1:${port}`, objects, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

let fake: Awaited<ReturnType<typeof startFakeS3>>;
const BUCKET = "alink-test";
contract("S3Storage (contra un S3 simulado en memoria)", async () => {
  fake = await startFakeS3(BUCKET);
  const storage = new S3Storage({ endpoint: fake.endpoint, region: "us-east-1", bucket: BUCKET, accessKeyId: "AKIATESTONLY", secretAccessKey: "secreto-de-prueba" });
  return { storage, cleanup: () => fake.close() };
});

describe("S3Storage: detalles del protocolo", () => {
  it("usa direccionamiento por ruta (bucket/clave), firma las peticiones y no envía credenciales en claro", async () => {
    const f = await startFakeS3(BUCKET);
    try {
      const storage = new S3Storage({ endpoint: f.endpoint, region: "us-east-1", bucket: BUCKET, accessKeyId: "AKIATESTONLY", secretAccessKey: "secreto-de-prueba" });
      const key = newKey();
      await storage.put(key, Buffer.from("hola"), "application/pdf");
      expect(f.objects.get(key)?.body.toString()).toBe("hola");
      expect(f.objects.get(key)?.type).toBe("application/pdf");
      expect(f.requests.every((r) => r.path.startsWith(`/${BUCKET}/exports/`))).toBe(true);
      expect(f.requests.every((r) => r.authorization?.includes("Credential=AKIATESTONLY/"))).toBe(true);
      expect(f.requests.some((r) => r.authorization?.includes("secreto-de-prueba"))).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("un error de servidor distinto de «no existe» se propaga (no se confunde con un objeto ausente)", async () => {
    const f = await startFakeS3("otro-bucket"); // el bucket no coincide → 403
    try {
      const storage = new S3Storage({ endpoint: f.endpoint, region: "us-east-1", bucket: BUCKET, accessKeyId: "a", secretAccessKey: "b" });
      await expect(storage.get(newKey())).rejects.not.toBeInstanceOf(StorageNotFoundError);
      await expect(storage.exists(newKey())).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
});

describe("configuración del almacenamiento", () => {
  const base = { APP_ORIGINS: "http://localhost:5173", DATABASE_URL: "mysql://u:p@localhost:3306/db", SESSION_SECRET: "a".repeat(40) };

  it("por defecto usa disco local en una ruta absoluta y límites razonables", () => {
    const c = loadConfig(base);
    expect(c.storage.driver).toBe("local");
    expect(c.storage.driver === "local" && c.storage.localDir).toMatch(/storage$/);
    expect(c.maxExportFileBytes).toBe(50 * 1024 * 1024);
    expect(c.exportQuotaBytes).toBe(512 * 1024 * 1024);
  });

  it("con s3 exige bucket y credenciales, y no revela sus valores en el error", () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: "s3" })).toThrow(ConfigError);
    let message = "";
    try {
      loadConfig({ ...base, STORAGE_DRIVER: "s3", S3_SECRET_ACCESS_KEY: "SECRETO-S3" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/S3_BUCKET/);
    expect(message).toMatch(/S3_ACCESS_KEY_ID/);
    expect(message).not.toContain("SECRETO-S3");
    const ok = loadConfig({ ...base, STORAGE_DRIVER: "s3", S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "alink", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
    expect(ok.storage).toMatchObject({ driver: "s3", endpoint: "http://minio:9000", bucket: "alink", region: "us-east-1" });
  });

  it("rechaza un driver desconocido o un endpoint que no es una URL", () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: "ftp" })).toThrow(/STORAGE_DRIVER/);
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: "s3", S3_ENDPOINT: "no-es-url", S3_BUCKET: "alink", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" })).toThrow(/S3_ENDPOINT/);
  });
});
