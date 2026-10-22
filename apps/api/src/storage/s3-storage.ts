import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { StorageNotFoundError, StorageService, assertValidStorageKey } from "./storage.service.js";

export interface S3Options {
  /** Vacío = AWS S3. Con valor (MinIO, Ceph...) se usa direccionamiento por ruta (`endpoint/bucket/clave`). */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function isMissing(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

/**
 * S3 / MinIO. El bucket debe ser PRIVADO (sin política pública ni URL prefirmadas: la descarga siempre pasa por la API).
 * Las claves son las mismas que en disco (`exports/<ownerId>/<uuid>`).
 */
export class S3Storage extends StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3Options, client?: S3Client) {
    super();
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
        credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
        // Sin sumas de comprobación «de trailer»: MinIO y otros compatibles antiguos no las admiten siempre.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentLength: data.length, ContentType: contentType }));
  }

  async get(key: string): Promise<{ stream: Readable; size: number }> {
    assertValidStorageKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new StorageNotFoundError();
      return { stream: res.Body as Readable, size: res.ContentLength ?? 0 };
    } catch (err) {
      if (isMissing(err)) throw new StorageNotFoundError();
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }
}
