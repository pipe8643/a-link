import type { Readable } from "node:stream";

/** El objeto pedido no existe en el almacenamiento (nunca se usa para distinguir propietarios: eso se decide antes, en la BD). */
export class StorageNotFoundError extends Error {
  constructor() {
    super("Objeto no encontrado en el almacenamiento.");
    this.name = "StorageNotFoundError";
  }
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^exports/${UUID}/${UUID}$`);

/**
 * Claves de almacenamiento: `exports/<ownerId>/<uuid>`. Las genera SIEMPRE el servidor (`newExportKey`); el nombre
 * que escribe el usuario no forma parte de ninguna ruta. Cada adaptador vuelve a validar la clave que recibe como
 * defensa en profundidad contra *path traversal* aunque hoy ningún dato del cliente llegue hasta aquí.
 */
export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function assertValidStorageKey(key: string): void {
  if (!isValidStorageKey(key)) throw new Error("Clave de almacenamiento no válida.");
}

/** Almacenamiento PRIVADO de ficheros: nunca se sirve de forma pública; solo la API lo lee tras autorizar. */
export abstract class StorageService {
  /** Escribe (o sustituye) el objeto de forma atómica: nadie ve nunca un fichero a medias. */
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Flujo de lectura y tamaño. Lanza `StorageNotFoundError` si no existe. */
  abstract get(key: string): Promise<{ stream: Readable; size: number }>;
  /** Idempotente: borrar algo que no existe no es un error. */
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}
