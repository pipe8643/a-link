import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { StorageNotFoundError, StorageService, assertValidStorageKey } from "./storage.service.js";

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/**
 * Disco local. El directorio raíz debe estar FUERA de cualquier ruta servida estáticamente (ver `STORAGE_LOCAL_DIR`).
 * Los ficheros se crean con permisos 0600 y se escriben en un temporal que se renombra al final (atómico).
 */
export class LocalDiskStorage extends StorageService {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = resolve(rootDir);
  }

  /** Ruta absoluta de la clave, garantizando que queda dentro de la raíz. */
  private pathOf(key: string): string {
    assertValidStorageKey(key);
    const full = resolve(this.root, ...key.split("/"));
    if (!full.startsWith(this.root + sep)) throw new Error("Clave de almacenamiento fuera del directorio.");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data, { mode: 0o600, flag: "wx" });
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async get(key: string): Promise<{ stream: Readable; size: number }> {
    const full = this.pathOf(key);
    try {
      const handle = await open(full, "r");
      try {
        const { size } = await handle.stat();
        return { stream: handle.createReadStream({ autoClose: true }), size };
      } catch (err) {
        await handle.close().catch(() => undefined);
        throw err;
      }
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError();
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
